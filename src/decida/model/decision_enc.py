"""DecidaBERT-large-v1.1 / -v2 format: one sequence holds the state and every question, read in one forward pass.

Layout: [CLS] state [SEP] q1 [SEP] q2 [SEP] ... Each question is " <type> question: <instructions>" (plus what yes and
no mean, when given), then a [MASK] marker read by the yes/no head, then for choice and score one [MASK] marker per
option or level followed by its text, read by the choice or score head. When the request is longer than the context,
option texts are shortened first (halving their token cap down to 8) until at least 256 tokens are left for the state,
and then the end of the state is cut.

A checkpoint in this format holds `config.json` (a ModernBERT encoder), `model.safetensors` (encoder plus the heads
`noul_head`, `choice_head`, `score_head`), the tokenizer, and `decision_config.json` with the token budgets and the
per-type temperatures that turn the top answer's probability into a calibrated `confidence`. `probabilities` stay raw.
"""
from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import torch
from torch import nn

MIN_STATE_ROOM = 256   # tokens kept for the state before option texts stop being shortened
MIN_OPTION_CAP = 8


def _text(value: Any) -> str:
    """Text as given; anything structured as JSON with json.dumps's default separators, as in training."""
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


def question_text(q: dict[str, Any]) -> str:
    text = f"{q['type']} question: {_text(q.get('instructions', ''))}"
    crit = q.get("criteria")
    if q["type"] == "noul" and isinstance(crit, dict):
        if crit.get("true"):
            text += f" | yes means: {_text(crit['true'])}"
        if crit.get("false"):
            text += f" | no means: {_text(crit['false'])}"
    return text


def options(q: dict[str, Any]) -> tuple[list[str], list[str]]:
    """The answer keys and the text written after each option marker (none for yes/no questions)."""
    crit = q.get("criteria")
    if q["type"] == "choice":
        if isinstance(crit, list):
            crit = {str(x): "" for x in crit}
        assert isinstance(crit, dict)
        return list(crit), [f"{k.replace('_', ' ')}: {_text(v)}" if v else k.replace("_", " ") for k, v in crit.items()]
    if q["type"] == "score":
        levels = list(crit.values()) if isinstance(crit, dict) else list(crit or [])
        return [str(i) for i in range(len(levels))], [f"level {i}: {_text(v)}" for i, v in enumerate(levels)]
    return [], []


@dataclass
class DecisionEncoded:
    input_ids: list[int]
    noul: list[tuple[int, str]]                                  # (marker position, qid)
    groups: list[tuple[list[int], str, str, list[str]]]          # (marker positions, type, qid, answer keys)
    state_cut: bool
    options_cut: int                                             # options whose text was shortened
    dropped: list[str] = field(default_factory=list)             # questions with no marker inside the context


class DecisionLayout:
    def __init__(self, tokenizer: Any, max_len: int, head_max_tokens: int, option_max_tokens: int):
        self.tok, self.max_len, self.head_max, self.opt_max = tokenizer, max_len, head_max_tokens, option_max_tokens
        self.CLS, self.SEP, self.MASK = tokenizer.cls_token_id, tokenizer.sep_token_id, tokenizer.mask_token_id

    def _ids(self, text: str) -> list[int]:
        return self.tok(text, add_special_tokens=False)["input_ids"]

    def encode(self, state: Any, questions: dict[str, dict[str, Any]]) -> DecisionEncoded:
        st = self._ids(_text(state))
        qs = []
        for qid, q in questions.items():
            keys, texts = options(q)
            qs.append({"qid": qid, "type": q["type"], "head": self._ids(" " + question_text(q)), "keys": keys,
                       "opts": [self._ids(" " + t) for t in texts]})
        cap = self.opt_max
        while True:
            qpart: list[int] = []
            marks = []
            for q in qs:
                ids = q["head"][:self.head_max]
                qmark = len(qpart) + len(ids)
                ids = ids + [self.MASK]
                offs = []
                for opt in q["opts"]:
                    offs.append(len(qpart) + len(ids))
                    ids = ids + [self.MASK] + opt[:cap]
                ids = ids + [self.SEP]
                marks.append((q, qmark, offs))
                qpart += ids
            room = self.max_len - 2 - len(qpart)
            if room >= MIN_STATE_ROOM or cap <= MIN_OPTION_CAP:
                break
            cap //= 2
        state_ids = st[:max(0, room)]
        base = 2 + len(state_ids)
        ids = ([self.CLS] + state_ids + [self.SEP] + qpart)[:self.max_len]
        noul, groups, dropped = [], [], []
        for q, qmark, offs in marks:
            if q["type"] == "noul":
                if base + qmark < len(ids):
                    noul.append((base + qmark, q["qid"]))
                else:
                    dropped.append(q["qid"])
            elif offs and base + offs[-1] < len(ids):
                groups.append(([base + o for o in offs], q["type"], q["qid"], q["keys"]))
            else:
                dropped.append(q["qid"])
        options_cut = sum(1 for q in qs for o in q["opts"] if len(o) > cap)
        return DecisionEncoded(ids, noul, groups, len(state_ids) < len(st), options_cut, dropped)


def _head(d: int) -> nn.Sequential:
    return nn.Sequential(nn.Linear(d, d), nn.GELU(), nn.LayerNorm(d), nn.Linear(d, 1))


@dataclass
class DecisionAnswer:
    type: str
    probs: list[float]     # choice: one per option; score: one per level; noul: [false, true]
    confidence: float      # the top answer's probability after the per-type temperature


class DecisionModel(nn.Module):
    def __init__(self, encoder: nn.Module, layout: DecisionLayout, temperature: dict[str, float]):
        super().__init__()
        self.encoder, self.layout, self.temperature = encoder, layout, temperature
        encoder_config: Any = getattr(encoder, "config")  # noqa: B009  a transformers config; nn.Module does not declare it
        d = int(encoder_config.hidden_size)
        self.noul_head, self.choice_head, self.score_head = _head(d), _head(d), _head(d)

    @torch.no_grad()
    def predict(self, state: Any, questions: dict[str, dict[str, Any]]) -> tuple[dict[str, DecisionAnswer], DecisionEncoded]:
        """Answer every question about `state` in one forward pass."""
        enc = self.layout.encode(state, questions)
        if enc.dropped:
            raise ValueError(f"the questions alone do not fit in {self.layout.max_len} tokens (no room left for: "
                             f"{', '.join(enc.dropped)}); send fewer or shorter questions")
        dev = next(self.parameters()).device
        x = torch.tensor([enc.input_ids], device=dev)
        h = self.encoder(input_ids=x, attention_mask=torch.ones_like(x)).last_hidden_state[0]
        out: dict[str, DecisionAnswer] = {}
        for pos, qid in enc.noul:
            z = float(self.noul_head(h[pos]).squeeze(-1))
            p = 1 / (1 + math.exp(-z))
            pc = 1 / (1 + math.exp(-z / self.temperature["noul"]))
            out[qid] = DecisionAnswer("noul", [1 - p, p], max(pc, 1 - pc))
        for poss, qtype, qid, _ in enc.groups:
            head = self.choice_head if qtype == "choice" else self.score_head
            z = head(h[poss]).squeeze(-1).float().cpu().numpy()
            p = np.exp(z - z.max())
            p /= p.sum()
            zt = z / self.temperature[qtype]
            pt = np.exp(zt - zt.max())
            pt /= pt.sum()
            out[qid] = DecisionAnswer(qtype, [float(v) for v in p], float(pt.max()))
        return {qid: out[qid] for qid in questions}, enc

    @classmethod
    def from_pretrained(cls, path: str) -> DecisionModel:
        from safetensors.torch import load_file
        from transformers import AutoConfig, AutoModel, AutoTokenizer

        with open(os.path.join(path, "decision_config.json"), encoding="utf-8") as f:
            dc = json.load(f)
        # ROCm (HIP) builds of PyTorch fail with hipErrorInvalidValue on gfx1151 with SDPA attention (see model/enc.py).
        attn_impl = "eager" if getattr(torch.version, "hip", None) else "sdpa"
        enc = AutoModel.from_config(AutoConfig.from_pretrained(path), attn_implementation=attn_impl)
        layout = DecisionLayout(AutoTokenizer.from_pretrained(path), int(dc["max_len"]), int(dc["head_max_tokens"]),
                                int(dc["option_max_tokens"]))
        model = cls(enc, layout, {k: float(v) for k, v in dc["confidence_temperature"].items()})
        missing, unexpected = model.load_state_dict(load_file(os.path.join(path, "model.safetensors")), strict=False)
        if missing or unexpected:
            raise ValueError(f"{path}: not a DecidaBERT-v2-format checkpoint (missing {missing[:3]}, unexpected {unexpected[:3]})")
        return model.float()
