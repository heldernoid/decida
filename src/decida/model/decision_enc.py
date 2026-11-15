"""DecidaBERT-large-v1.1 / -v2 format: one sequence holds the state and every question, read in one forward pass.

Layout: [CLS] state [SEP] q1 [SEP] q2 [SEP] ... Each question is " <type> question: <instructions>" (plus what yes and
no mean, when given), then a [MASK] marker read by the yes/no head, then for choice and score one [MASK] marker per
option or level followed by its text, read by the choice or score head. When the request is longer than the context,
option texts are shortened first (halving their token cap down to 8) until at least 256 tokens are left for the state,
and then the end of the state is cut.

A request with more than QUESTIONS_PER_PASS questions, or whose questions do not fit beside the state, is read in
several passes: each holds the state (up to half the context) and an even share of the questions, and all of them run
in one padded batch. Every training case had exactly five questions, and answers degrade when more share a pass. On 100
typed-decisions train cases (500 questions), agreement with the gold label for a case's own five questions, read alone
or sharing the pass with other cases' questions:

    v2:   1 per pass 81.2%, 3: 82.2%, 5: 83.6%, 5 + 3 others: 80.2%, + 10: 79.6%, + 30: 74.2%, + 60: 67.4%
    v1.1: 1 per pass 76.6%, 3: 78.6%, 5: 79.2%, 5 + 3 others: 77.4%, + 10: 78.2%, + 30: 70.6%, + 60: 62.2%

A request of up to five questions that fits is one pass, exactly as the models' own inference code reads it.

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
QUESTIONS_PER_PASS = 5      # as in training (every typed-decisions case has five); see the module docstring
BATCH_TOKENS = 32768        # padded tokens per forward when a request is read in several passes


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

    def question_tokens(self, q: dict[str, Any]) -> int:
        """The tokens one question takes in a sequence at the full option budget (markers and separator included)."""
        _, texts = options(q)
        head = min(len(self._ids(" " + question_text(q))), self.head_max)
        return head + 1 + sum(1 + min(len(self._ids(" " + t)), self.opt_max) for t in texts) + 1

    def passes(self, state: Any, questions: dict[str, dict[str, Any]], per_pass: int = QUESTIONS_PER_PASS) -> list[list[str]]:
        """The questions in request order, split into groups of at most `per_pass`, as even as possible (twelve:
        4, 4, 4, not 5, 5, 2), that each fit in one sequence beside the state (the state keeps up to half the
        context). A question too long for any group gets a group of its own."""
        budget = self.max_len - 2 - min(len(self._ids(_text(state))), self.max_len // 2)
        n = len(questions)
        size = math.ceil(n / math.ceil(n / per_pass)) if n else per_pass
        groups: list[list[str]] = []
        cur: list[str] = []
        used = 0
        for qid, q in questions.items():
            cost = self.question_tokens(q)
            if cur and (used + cost > budget or len(cur) == size):
                groups.append(cur)
                cur, used = [], 0
            cur.append(qid)
            used += cost
        if cur:
            groups.append(cur)
        return groups


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
    def predict(self, state: Any, questions: dict[str, dict[str, Any]]) -> tuple[dict[str, DecisionAnswer], list[DecisionEncoded]]:
        """Answer every question about `state`: in one forward pass, or in several (see the module docstring)."""
        encs: list[DecisionEncoded] = []
        if len(questions) <= QUESTIONS_PER_PASS:
            encs = [self.layout.encode(state, questions)]
        if not encs or encs[0].dropped:
            encs = [self.layout.encode(state, {qid: questions[qid] for qid in g}) for g in self.layout.passes(state, questions)]
        dropped = [qid for e in encs for qid in e.dropped]
        if dropped:
            raise ValueError(f"a question is too long to fit in {self.layout.max_len} tokens even on its own "
                             f"({', '.join(dropped)}); shorten its instructions or options")
        out: dict[str, DecisionAnswer] = {}
        for batch in self._batches(encs):
            for e, h in zip(batch, self._encode(batch)):
                out.update(self._read(e, h))
        return {qid: out[qid] for qid in questions}, encs

    def _batches(self, encs: list[DecisionEncoded]) -> list[list[DecisionEncoded]]:
        """Consecutive passes grouped so that each padded batch stays under BATCH_TOKENS."""
        out: list[list[DecisionEncoded]] = []
        cur: list[DecisionEncoded] = []
        for e in encs:
            if cur and (len(cur) + 1) * max(len(e.input_ids), *(len(c.input_ids) for c in cur)) > BATCH_TOKENS:
                out.append(cur)
                cur = []
            cur.append(e)
        return out + [cur] if cur else out

    def _encode(self, batch: list[DecisionEncoded]) -> torch.Tensor:
        """The encoder's hidden states for a batch of passes, right-padded (one pass: no padding at all)."""
        dev = next(self.parameters()).device
        n = max(len(e.input_ids) for e in batch)
        pad = self.layout.tok.pad_token_id
        x = torch.tensor([e.input_ids + [pad] * (n - len(e.input_ids)) for e in batch], device=dev)
        mask = torch.tensor([[1] * len(e.input_ids) + [0] * (n - len(e.input_ids)) for e in batch], device=dev)
        return self.encoder(input_ids=x, attention_mask=mask).last_hidden_state

    def _read(self, enc: DecisionEncoded, h: torch.Tensor) -> dict[str, DecisionAnswer]:
        """The answer for every marker of one pass, from its hidden states."""
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
        return out

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
