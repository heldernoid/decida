"""Contrastive-LM (CLM) reference inference, reimplemented (not installed: the `contrastive-lm` package was too new to depend on).

Scheme, read from https://github.com/Contrastive-LM/CLM (src/clm/schema.py, heads.py, engine.py, embedder.py) and verified against the checkpoint:
  state text  = state + blank line + question instructions        -> frozen LLM, last-token hidden state, L2 -> state head  (MLP 4096-1536-1536-512)
  candidates  = each option's text (choice: description or key; score: level text; noul: 'false: No. This is false: ...' / 'true: Yes. ...')
                                                                   -> same frozen LLM -> action head
  answer      = softmax over options of exp(logit_scale) * cos(state_proj, action_proj)
The encoder embedding is what vLLM's pooling runner returns for Qwen3-8B: final-norm hidden state of the last token, prompts truncated
from the left to 2048 tokens (vLLM `truncate_prompt_tokens`), so the question at the end of the state text is kept."""
import asyncio
import json
import logging
import time
from collections import OrderedDict
from typing import Any

import torch
import torch.nn.functional as F
from torch import nn

from decida.runtime.device import compute_lock
from decida.serve.engine import SystemOneRequest, format_answer

logger = logging.getLogger("decida.serve.clm")
NOUL_KEYS = ("false", "true")
PROMPT_VERSION = "clm-reference-v0"


def to_text(x: Any, indent: int = 0) -> str:
    """Plain-text rendering of a state or description (heads are trained on prose, not JSON)."""
    if x is None:
        return ""
    if isinstance(x, str):
        return x
    if isinstance(x, bool):
        return "true" if x else "false"
    if isinstance(x, (int, float)):
        return str(x)
    pad = " " * indent
    if isinstance(x, dict):
        parts = [f"{pad}{k}:\n{to_text(v, indent + 2)}" if isinstance(v, (dict, list)) and v else f"{pad}{k}: {to_text(v)}" for k, v in x.items()]
        return ("\n\n" if indent == 0 else "\n").join(parts)
    if isinstance(x, (list, tuple)):
        parts = [f"{pad}-\n{to_text(v, indent + 2)}" if isinstance(v, (dict, list)) and v else f"{pad}- {to_text(v)}" for v in x]
        return "\n".join(parts)
    return json.dumps(x, ensure_ascii=False)


def state_text(state: Any, instructions: Any) -> str:
    s, i = to_text(state).strip(), to_text(instructions).strip()
    return f"{s}\n\n{i}" if s and i else (s or i)


def candidate_texts(qtype: str, criteria: Any, instructions: str) -> list[str]:
    """Candidate text per option, in answer order (choice keys, score levels, noul [false, true])."""
    if qtype == "choice":
        if isinstance(criteria, list):
            criteria = {str(c): "" for c in criteria}
        return [to_text(v) if v not in (None, "") else k for k, v in criteria.items()]
    if qtype == "score":
        return [to_text(c) for c in criteria]
    ins = to_text(instructions).strip()
    crit = criteria if isinstance(criteria, dict) else {}
    out = []
    for k in NOUL_KEYS:
        d = crit.get(k)
        if d in (None, ""):
            d = (f"Yes. This is true: {ins}" if k == "true" else f"No. This is false: {ins}") if ins else k
        out.append(f"{k}: {to_text(d)}")
    return out


def make_head(width: int, depth: int, proj: int, hidden: int, activation: str = "gelu", layernorm: bool = False, residual: bool = False) -> nn.Module:
    act = {"gelu": nn.GELU, "relu": nn.ReLU, "silu": nn.SiLU}[activation]

    class Head(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.inp = nn.Linear(hidden, width)
            self.hidden = nn.ModuleList(nn.Linear(width, width) for _ in range(depth - 2))
            self.norms = nn.ModuleList((nn.LayerNorm(width) if layernorm else nn.Identity()) for _ in range(depth - 2))
            self.out = nn.Linear(width, proj)
            self.act, self.residual = act(), residual

        def forward(self, x: torch.Tensor) -> torch.Tensor:
            x = self.act(self.inp(x))
            for lin, nrm in zip(self.hidden, self.norms, strict=True):
                h = self.act(nrm(lin(x)))
                x = x + h if self.residual else h
            return self.out(x)

    return Head()


def load_heads(path: str, device: str) -> tuple[nn.Module, nn.Module, float, dict[str, Any]]:
    """State head, action head, score scale and cfg from a CLM checkpoint. Loaded with weights_only=True (tensors and plain values only)."""
    ck = torch.load(path, map_location="cpu", weights_only=True)
    cfg = dict(ck["cfg"])
    kw = {"width": cfg["width"], "depth": cfg["depth"], "proj": ck.get("projection_dim", cfg.get("projection_dim", 512)),
          "hidden": cfg.get("hidden_size", 4096), "activation": cfg.get("activation", "gelu"), "layernorm": cfg.get("layernorm", False),
          "residual": cfg.get("residual", False)}
    sh, ah = make_head(**kw), make_head(**kw)
    sh.load_state_dict(ck["state_head"])
    ah.load_state_dict(ck["action_head"])
    scale = float(torch.as_tensor(ck["logit_scale"]).float().exp().clamp(max=100.0))
    return sh.eval().to(device), ah.eval().to(device), scale, cfg


class CLMEngine:
    family = "clm"

    def __init__(self, encoder, tokenizer, state_head, action_head, scale: float, device: str, max_tokens: int = 2048, batch_tokens: int = 4096,
                 cache_size: int = 100_000, model_id: str = "clm"):
        self.encoder, self.tokenizer, self.state_head, self.action_head = encoder, tokenizer, state_head, action_head
        self.scale, self.device, self.max_tokens, self.batch_tokens, self.model_id = scale, device, max_tokens, batch_tokens, model_id
        self.cache: OrderedDict[str, torch.Tensor] = OrderedDict()
        self.cache_size = cache_size
        self._queue: list = []
        self._lock = asyncio.Lock()

    @classmethod
    def load(cls, encoder_id: str, heads_path: str, device: str = "auto", dtype: str = "auto", revision: str | None = None) -> "CLMEngine":
        from transformers import AutoModel, AutoTokenizer
        if device == "auto":
            device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
        td = {"auto": torch.float32 if device == "cpu" else torch.bfloat16, "float32": torch.float32, "bfloat16": torch.bfloat16, "float16": torch.float16}[dtype]
        tok = AutoTokenizer.from_pretrained(encoder_id, revision=revision)
        tok.padding_side = "right"
        enc = AutoModel.from_pretrained(encoder_id, revision=revision, dtype=td).to(device).eval()
        sh, ah, scale, _ = load_heads(heads_path, device)
        logger.info("loaded CLM encoder %s + heads %s on %s", encoder_id, heads_path, device)
        return cls(enc, tok, sh, ah, scale, device, model_id=encoder_id)

    @torch.inference_mode()
    def embed(self, texts: list[str]) -> torch.Tensor:
        """[n, hidden] L2-normalised float32 last-token embeddings, cached by text. Right-padded batches are exact for causal encoders."""
        missing = [t for t in dict.fromkeys(texts) if t not in self.cache]
        if missing:
            ids = [self.tokenizer.encode(t, add_special_tokens=False)[-self.max_tokens:] or [self.tokenizer.pad_token_id] for t in missing]
            order = sorted(range(len(missing)), key=lambda i: len(ids[i]))
            i = 0
            while i < len(order):
                j, longest = i, 0
                while j < len(order) and max(longest, len(ids[order[j]])) * (j - i + 1) <= self.batch_tokens or j == i:
                    longest = max(longest, len(ids[order[j]]))
                    j += 1
                chunk = order[i:j]
                width = max(len(ids[k]) for k in chunk)
                pad = self.tokenizer.pad_token_id or 0
                inp = torch.tensor([ids[k] + [pad] * (width - len(ids[k])) for k in chunk], device=self.device)
                att = torch.tensor([[1] * len(ids[k]) + [0] * (width - len(ids[k])) for k in chunk], device=self.device)
                h = self.encoder(input_ids=inp, attention_mask=att).last_hidden_state
                last = h[torch.arange(len(chunk)), att.sum(1) - 1].float()
                vec = F.normalize(last, dim=-1).cpu()
                for k, v in zip(chunk, vec, strict=True):
                    self.cache[missing[k]] = v
                i = j
            while len(self.cache) > self.cache_size:
                self.cache.popitem(last=False)
        return torch.stack([self.cache[t] for t in texts])

    @torch.inference_mode()
    def option_probs(self, state: Any, qtype: str, instructions: str, criteria: Any) -> tuple[list[float], int]:
        cands = candidate_texts(qtype, criteria, instructions)
        st = state_text(state, instructions)
        zs = F.normalize(self.state_head(self.embed([st]).to(self.device)), dim=-1)[0]
        za = F.normalize(self.action_head(self.embed(cands).to(self.device)), dim=-1)
        logits = self.scale * (za @ zs)
        return F.softmax(logits.float(), dim=-1).cpu().tolist(), len(self.tokenizer.encode(st, add_special_tokens=False))

    def predict_sync(self, req: SystemOneRequest) -> dict[str, Any]:
        with compute_lock(self.device):   # one model on the GPU at a time (see runtime/device.py)
            return self._predict_unlocked(req)

    def _predict_unlocked(self, req: SystemOneRequest) -> dict[str, Any]:
        answers, tokens = {}, 0
        noul_conf = bool(req.x_decida.get("noul_confidence", False))
        for qid, q in req.questions.items():
            t = q["type"]
            crit = q.get("criteria", {})
            probs, n = self.option_probs(req.state, t, q["instructions"], crit)
            answers[qid] = format_answer(t, probs, ({str(c): "" for c in crit} if t == "choice" and isinstance(crit, list) else crit), noul_conf)
            tokens += n
        return {"model": req.model, "answers": answers, "usage": {"input_tokens": tokens, "output_tokens": 0}}

    async def predict_async(self, req: SystemOneRequest) -> dict[str, Any]:
        async with self._lock:
            start = time.perf_counter()
            resp = await asyncio.to_thread(self.predict_sync, req)
            resp["x_decida"] = {"prompt_version": PROMPT_VERSION, "engine_seconds": round(time.perf_counter() - start, 4), "model_id": self.model_id}
            return resp
