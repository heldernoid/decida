"""GLiNER2.5-Decide / GLiNER2.5-multi-Decide, read directly with `transformers`/`torch`.

These checkpoints ship a much larger package (`gliner2`, span/entity extraction, a schema compiler, a
constraint-satisfaction decoder) that Decida does not need: every typed question here is independent, with no
cross-question constraints. The slice this module reimplements is only the classification path, traced from
`gliner2`'s own source (`gliner2/classification/scoring.py`, `gliner2/processor.py`): a DeBERTa-v2 encoder marks
each answer option with a `[L]` token in the prompt, and after encoding, the hidden state at each `[L]` position
goes through a small two-layer head to get one score per option — the same shape as Decida's own `DecidaEncModel`
(mask-position readout + linear head), just with different marker tokens and a bigger backbone. No `gliner2`
package is installed or imported.

Two checkpoints load through this module (`fastino/GLiNER2.5-Decide`, `microsoft/deberta-v3-large`, "span"
architecture) and (`fastino/GLiNER2.5-multi-Decide`, `microsoft/mdeberta-v3-base`, "boundary" architecture); their
classification heads differ only in the layer index of the final Linear (`classifier.2` vs `classifier.3`, the
extra index being an eval-mode-inert Dropout), so both are read the same way.
"""
from __future__ import annotations

import json
import os
from typing import Any

import torch
from safetensors.torch import load_file
from torch import nn
from transformers import AutoConfig, AutoModel, AutoTokenizer

SPECIAL_TOKENS = ["[SEP_STRUCT]", "[SEP_TEXT]", "[P]", "[C]", "[E]", "[R]", "[L]", "[EXAMPLE]", "[OUTPUT]", "[DESCRIPTION]"]
DEFAULT_MAX_LEN = 512  # the trained position count; DeBERTa's relative-position buckets let it run longer (untested for quality)


def labels_for(qtype: str, criteria: Any) -> dict[str, str | None]:
    """Option name -> description, in the exact order `serve.engine.format_answer` expects its probability list in.

    `noul` reads back as `[false, true]` (see `format_answer`), so the labels are built `no` before `yes`.
    """
    if qtype == "choice":
        return dict(criteria.items())
    if qtype == "score":
        return {str(i): (c if isinstance(c, str) else json.dumps(c, ensure_ascii=False)) for i, c in enumerate(criteria)}
    crit = criteria or {}
    return {"no": crit.get("false") or None, "yes": crit.get("true") or None}


def build_prompt(instructions: str, labels: dict[str, str | None], state: Any) -> str:
    """The exact text `gliner2` would score: instructions and label descriptions, then one `[L]` marker per label
    (in `labels`' order, read back by `score_many`), then the state."""
    prompt = instructions
    for name, desc in labels.items():
        if desc:
            prompt += f" [DESCRIPTION] {name}: {desc}"
    return "( [P] " + prompt + " ( " + " ".join(f"[L] {name}" for name in labels) + " ) ) [SEP_TEXT] " + str(state)


class ClassifierHead(nn.Module):
    """`Linear(hidden, mid) -> GELU -> Linear(mid, 1)`. A dropout sits between the two in training; it is the
    identity in eval mode, so it is not reproduced here."""

    def __init__(self, hidden: int, mid: int):
        super().__init__()
        self.fc1 = nn.Linear(hidden, mid)
        self.act = nn.GELU()
        self.fc2 = nn.Linear(mid, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.fc2(self.act(self.fc1(x))).squeeze(-1)


class GlinerModel:
    def __init__(self, encoder: nn.Module, classifier: ClassifierHead, tokenizer, max_len: int = DEFAULT_MAX_LEN):
        self.encoder, self.classifier, self.tokenizer, self.max_len = encoder, classifier, tokenizer, max_len
        self.l_token_id = tokenizer.convert_tokens_to_ids("[L]")

    def to(self, device: str) -> GlinerModel:
        self.encoder.to(device)
        self.classifier.to(device)
        return self

    def eval(self) -> GlinerModel:
        self.encoder.eval()
        self.classifier.eval()
        return self

    @classmethod
    def from_pretrained(cls, path: str, max_len: int = DEFAULT_MAX_LEN) -> GlinerModel:
        tokenizer = AutoTokenizer.from_pretrained(path)
        if not all(t in tokenizer.get_vocab() for t in SPECIAL_TOKENS):
            tokenizer.add_special_tokens({"additional_special_tokens": SPECIAL_TOKENS})

        # DebertaV2Model does not support SDPA attention in this transformers version at all (not a ROCm-specific
        # issue here, unlike src/decida/model/enc.py's ModernBERT backbone) — eager is the only implementation
        # available for this architecture.
        # GLiNER2.5-multi-Decide's encoder_config declares dtype "float16" (plain Decide says "float32"); Decida
        # always runs encoders in float32 (see model/enc.py), so force it here too. Without this, AutoModel leaves
        # some internal buffers at whatever dtype the config declares, since load_state_dict below only overwrites
        # the keys present in the checkpoint — a float16/float32 mix that MPS's matmul kernel hard-crashes the
        # whole process on (not a catchable Python exception), rather than the plain dtype-mismatch error CPU gives.
        ecfg = AutoConfig.from_pretrained(os.path.join(path, "encoder_config"))
        encoder = AutoModel.from_config(ecfg, attn_implementation="eager", dtype=torch.float32).float()

        weights = load_file(os.path.join(path, "model.safetensors"))
        weights = {k: v.float() for k, v in weights.items()}
        enc_weights = {k.removeprefix("encoder."): v for k, v in weights.items() if k.startswith("encoder.")}
        missing, unexpected = encoder.load_state_dict(enc_weights, strict=False)
        if missing or unexpected:
            raise ValueError(f"{path}: encoder weights do not match GLiNER2's expected layout "
                             f"({len(missing)} missing, {len(unexpected)} unexpected)")

        indices = sorted({int(k.split(".")[1]) for k in weights if k.startswith("classifier.") and k.endswith(".weight")})
        if len(indices) != 2:
            raise ValueError(f"{path}: expected a 2-layer classifier head, found layers at {indices}")
        first, last = indices
        classifier = ClassifierHead(hidden=ecfg.hidden_size, mid=weights[f"classifier.{first}.weight"].shape[0])
        classifier.fc1.weight.data = weights[f"classifier.{first}.weight"]
        classifier.fc1.bias.data = weights[f"classifier.{first}.bias"]
        classifier.fc2.weight.data = weights[f"classifier.{last}.weight"]
        classifier.fc2.bias.data = weights[f"classifier.{last}.bias"]

        return cls(encoder, classifier, tokenizer, max_len=max_len)

    def score(self, state: Any, instructions: str, labels: dict[str, str | None]) -> tuple[list[float], int]:
        """One question: the softmax over `labels` in the order given, and the real token count."""
        return self.score_many(state, [(instructions, labels)])[0]

    def score_many(self, state: Any, items: list[tuple[str, dict[str, str | None]]]) -> list[tuple[list[float], int]]:
        """Every question in `items` against the same state, in one padded batch and one encoder forward pass — the
        same batching the encoder engine already does (`serve/engine.py`), instead of one forward pass per question
        (each pays the encoder's full attention-over-the-prompt cost from scratch; batching pays it once)."""
        texts = [build_prompt(instructions, labels, state) for instructions, labels in items]
        enc = self.tokenizer(texts, return_tensors="pt", truncation=True, max_length=self.max_len, padding=True)
        device = next(self.encoder.parameters()).device
        enc = {k: v.to(device) for k, v in enc.items()}
        with torch.no_grad():
            hidden = self.encoder(**enc).last_hidden_state
        out = []
        for i, (_, labels) in enumerate(items):
            ids = enc["input_ids"][i].tolist()
            positions = [j for j, t in enumerate(ids) if t == self.l_token_id]
            if len(positions) != len(labels):
                raise ValueError(f"expected {len(labels)} [L] markers in the prompt, found {len(positions)} "
                                  f"(a label's own text collided with a marker token, or the prompt was truncated)")
            with torch.no_grad():
                logits = self.classifier(hidden[i, positions])
            n_tokens = int(enc["attention_mask"][i].sum().item())  # real tokens, not counting this row's padding
            out.append((torch.softmax(logits, dim=-1).tolist(), n_tokens))
        return out
