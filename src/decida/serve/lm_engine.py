"""Decoder-LM engine (the SemIf idea): no training, no generation. One forward pass per question; the probabilities are the model's
next-token logits restricted to the option-letter tokens. Serves the same /v1/systemone shape as the encoder engine.

Differences from SemIf's reference runner (https://github.com/TheoLeeCJ, read critically): a readable prompt instead of a JSON payload,
`noul` and `score` questions are mapped onto lettered options too, base models without a chat template use a plain prompt, and the
letter tokens are resolved with or without a leading space (SentencePiece/BPE tokenizers differ)."""
import asyncio
import json
import logging
import time
from typing import Any

import torch
import torch.nn.functional as F

from decida.runtime.device import compute_lock
from decida.serve.engine import SystemOneRequest, format_answer, normalize_criteria

logger = logging.getLogger("decida.serve.lm")
LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
PROMPT_VERSION = "lm-letters-v1"
SYSTEM = ("You judge evidence. Apply the question to the evidence and choose exactly one listed option. "
          "Respond with only its uppercase letter, with no explanation.")
NOUL_OPTIONS = ["No: the statement is false.", "Yes: the statement is true."]


def option_lines(qtype: str, criteria: Any) -> list[str]:
    """Option texts in answer order (choice keys, score levels 0..k-1, noul [false, true])."""
    if qtype == "noul":
        return list(NOUL_OPTIONS)
    if qtype == "score":
        return [str(level) for level in criteria]
    crit = normalize_criteria("choice", criteria)
    return [f"{key}: {desc}" if desc else str(key) for key, desc in crit.items()]


def build_user_text(state: Any, qtype: str, instructions: str, options: list[str]) -> str:
    ev = state if isinstance(state, str) else json.dumps(state, ensure_ascii=False)
    head = {"choice": "Choose the best option.", "score": "Rate on this scale, ordered from the lowest level (A) to the highest.",
            "noul": "Decide whether the statement is true."}[qtype]
    body = "\n".join(f"{LETTERS[i]}. {o}" for i, o in enumerate(options))
    label = "Statement" if qtype == "noul" else "Question"
    return f"Evidence:\n{ev}\n\n{label}: {instructions}\n\n{head}\n{body}\n\nAnswer with the letter only."


def resolve_slots(tokenizer, n: int, leading_space: bool) -> list[int]:
    """One token id per option letter. Chat prompts end after the assistant tag (letter without space); plain prompts end with
    'Answer:' (letter with a leading space)."""
    variants = [" ", ""] if leading_space else ["", " "]
    slots: list[int] = []
    for letter in LETTERS[:n]:
        for v in variants:
            enc = tokenizer.encode(v + letter, add_special_tokens=False)
            if len(enc) == 1:
                slots.append(enc[0])
                break
        else:
            raise ValueError(f"answer letter {letter!r} is not a single token for this tokenizer")
    if len(set(slots)) != len(slots):
        raise ValueError("answer-letter tokens collide")
    return slots


class LMEngine:
    family = "lm"

    def __init__(self, model, tokenizer, device: str, max_input_tokens: int = 4096, model_id: str = "lm"):
        self.model, self.tokenizer, self.device = model, tokenizer, device
        self.max_input_tokens, self.model_id = max_input_tokens, model_id
        self.has_chat = bool(getattr(tokenizer, "chat_template", None))
        self._queue: list = []  # kept so /health can report queue depth like the encoder engine
        self._lock = asyncio.Lock()

    @classmethod
    def load(cls, model_id: str, device: str = "auto", dtype: str = "auto", revision: str | None = None, max_input_tokens: int = 4096) -> "LMEngine":
        from transformers import AutoModelForCausalLM, AutoTokenizer
        if device == "auto":
            device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
        td = {"auto": torch.float32 if device == "cpu" else torch.bfloat16, "float32": torch.float32, "bfloat16": torch.bfloat16, "float16": torch.float16}[dtype]
        tok = AutoTokenizer.from_pretrained(model_id, revision=revision)
        attn_impl = "eager" if getattr(torch.version, "hip", None) else "sdpa"
        model = AutoModelForCausalLM.from_pretrained(model_id, revision=revision, dtype=td, attn_implementation=attn_impl).to(device).eval()  # pyright: ignore[reportArgumentType]  transformers' stub types the class-method call oddly
        logger.info("loaded %s on %s as %s", model_id, device, td)
        return cls(model, tok, device, max_input_tokens, model_id)

    def prompt_ids(self, user_text: str) -> tuple[list[int], bool]:
        """Token ids of the full prompt, and whether the answer letter should carry a leading space."""
        if self.has_chat:
            msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user_text}]
            try:
                text = self.tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False)
            except TypeError:
                text = self.tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
            return self.tokenizer.encode(text, add_special_tokens=False), False
        text = f"{SYSTEM}\n\n{user_text}\nAnswer:"
        return self.tokenizer.encode(text), True

    @torch.inference_mode()
    def option_probs(self, state: Any, qtype: str, instructions: str, criteria: Any) -> tuple[list[float], int]:
        options = option_lines(qtype, criteria)
        if not 2 <= len(options) <= len(LETTERS):
            raise ValueError(f"the LM engine supports 2-{len(LETTERS)} options, got {len(options)}")
        ids, spaced = self.prompt_ids(build_user_text(state, qtype, instructions, options))
        if len(ids) > self.max_input_tokens:
            raise ValueError(f"prompt has {len(ids)} tokens, over the limit {self.max_input_tokens}; the LM engine never truncates")
        slots = resolve_slots(self.tokenizer, len(options), spaced)
        inp = torch.tensor([ids], dtype=torch.long, device=self.device)
        kw: dict[str, Any] = {"input_ids": inp, "attention_mask": torch.ones_like(inp), "use_cache": False}
        try:
            logits = self.model(**kw, logits_to_keep=1).logits[0, -1]
        except TypeError:
            logits = self.model(**kw).logits[0, -1]
        return F.softmax(logits.float()[slots], dim=-1).cpu().tolist(), len(ids)

    def predict_sync(self, req: SystemOneRequest) -> dict[str, Any]:
        with compute_lock(self.device):   # one model on the GPU at a time (see runtime/device.py)
            return self._predict_unlocked(req)

    def _predict_unlocked(self, req: SystemOneRequest) -> dict[str, Any]:
        answers, tokens = {}, 0
        noul_conf = bool(req.x_decida.get("noul_confidence", False))
        for qid, q in req.questions.items():
            t = q["type"]
            probs, n = self.option_probs(req.state, t, q["instructions"], q.get("criteria", {}))
            answers[qid] = format_answer(t, probs, normalize_criteria(t, q.get("criteria", {})), noul_conf)
            tokens += n
        return {"model": req.model, "answers": answers, "usage": {"input_tokens": tokens, "output_tokens": 0}}

    async def predict_async(self, req: SystemOneRequest) -> dict[str, Any]:
        async with self._lock:  # one forward at a time: MPS aborts on concurrent inference
            start = time.perf_counter()
            resp = await asyncio.to_thread(self.predict_sync, req)
            resp["x_decida"] = {"prompt_version": PROMPT_VERSION, "engine_seconds": round(time.perf_counter() - start, 4), "model_id": self.model_id}
            return resp
