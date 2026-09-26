import asyncio
import json
import logging
import math
import os
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn.functional as F
from transformers import AutoTokenizer

from decida.model.enc import Batch, DecidaEncModel, LayaLayout
from decida.runtime.device import compute_lock
from decida.schema.models import CaseQuestion
from decida.schema.primitives import Primitive

logger = logging.getLogger("decida.engine")

def normalize_criteria(qtype: str, criteria: Any) -> Any:
    """Jev/laya accept `choice` criteria as a bare list of option labels; internally we use {label: description}."""
    if qtype == "choice" and isinstance(criteria, list):
        return {str(c): "" for c in criteria}
    return criteria


def _text(value: Any) -> Any:
    """Structured values (objects, lists) become compact JSON text; strings and numbers pass through as text."""
    if isinstance(value, str):
        return value
    if isinstance(value, dict | list):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return str(value)


def coerce_for_local(body: dict[str, Any]) -> dict[str, Any]:
    """Local engines read text. Hosted endpoints (Jev) accept structured state, instructions and option values, so callers
    may send them; before a local engine sees them they are turned into compact JSON text. Returns a new dict."""
    out = dict(body)
    if "state" in out and out["state"] is not None:
        out["state"] = _text(out["state"])
    questions = {}
    for qid, q in (out.get("questions") or {}).items():
        if not isinstance(q, dict):
            questions[qid] = q  # validation reports it
            continue
        q = dict(q)
        if "instructions" in q and q["instructions"] is not None:
            q["instructions"] = _text(q["instructions"])
        crit = q.get("criteria")
        if isinstance(crit, dict):
            q["criteria"] = {str(k): _text(v) for k, v in crit.items()}
        elif isinstance(crit, list):
            q["criteria"] = [_text(v) for v in crit]
        questions[qid] = q
    out["questions"] = questions
    return out


class SystemOneRequest:
    def __init__(self, data: dict[str, Any]):
        self.model = data.get("model")
        self.state = data.get("state")
        self.questions = data.get("questions", {})
        self.x_decida = data.get("x_decida", {})
        self.validate()

    def validate(self):
        if not self.model:
            raise ValueError("model is required")
        if not self.state:
            raise ValueError("state is required")
        if not self.questions or len(self.questions) > 256:
            raise ValueError("questions must have 1-256 entries")
        
        for v in self.questions.values():
            qtype = v.get("type")
            if qtype not in ["noul", "choice", "score"]:
                raise ValueError(f"Unknown question type: {qtype}")
            if "instructions" not in v or not v["instructions"]:
                raise ValueError("instructions is required and non-empty")
            if qtype == "choice":
                crit = v.get("criteria", {})
                if len(crit) < 2 or len(crit) > 255:
                    raise ValueError("choice criteria must have 2-255 options")
            elif qtype == "score":
                crit = v.get("criteria", [])
                if not isinstance(crit, list):
                    raise ValueError("score criteria must be a list")
                if len(crit) < 2 or len(crit) > 32:
                    raise ValueError("score criteria must have 2-32 levels")


def format_answer(qtype_str: str, probs: list[float], q_criteria: Any, noul_confidence: bool = False) -> dict[str, Any]:
    """Jev/laya-shaped answer for one question from its option probabilities (shared by every engine)."""
    ans: dict[str, Any] = {"type": qtype_str}
    k = len(probs)
    entropy = -sum(p * math.log(p) if p > 0 else 0 for p in probs)
    confidence = 1 - (entropy / math.log(k)) if k > 1 else 1.0
    if qtype_str == "noul":
        ans["noul"] = probs[1]  # [false, true]
        if noul_confidence:
            ans["confidence"] = abs(2 * probs[1] - 1)
    elif qtype_str == "choice":
        keys = list(q_criteria.keys())
        ans["probabilities"] = {key: probs[i] for i, key in enumerate(keys)}
        ans["choice"] = keys[int(np.argmax(probs))]
        ans["confidence"] = confidence
    elif qtype_str == "score":
        ans["probabilities"] = {str(i): probs[i] for i in range(k)}
        ans["score"] = sum(i * probs[i] for i in range(k))
        ans["legend"] = {str(i): v if isinstance(q_criteria, list) else str(v) for i, v in enumerate(q_criteria)}
        ans["confidence"] = confidence
    return ans


DEFAULT_MAX_LEN = 2048  # the backbone's position ceiling; pilot-style checkpoints were trained at 512, so longer inputs are untested for quality


def tokenizer_dir(model_dir: str) -> str:
    """Laya keeps the tokenizer in a tokenizer/ folder beside the weights; DecidaBERT-large keeps it next to them."""
    sub = os.path.join(model_dir, "tokenizer")
    return sub if os.path.isdir(sub) else model_dir


class Engine:
    def __init__(self, model, layout, device, dtype):
        self.model = model
        self.layout = layout
        self.device = device
        self.dtype = dtype
        self.qtypes_map = {"choice": 0, "score": 1, "noul": 2}

        # Micro-batching queues
        self._queue = []
        self._queue_lock = asyncio.Lock()
        self._batch_task = None
        self.max_wait_ms = 5
        self.max_batch_tokens = 32000
        self.max_options = 255

    @classmethod
    def load(cls, model_dir: str | Path, device="auto", dtype="auto", cache_bytes=None) -> "Engine":
        model_dir = str(model_dir)
        if device == "auto":
            if torch.cuda.is_available():
                device = "cuda"
            elif torch.backends.mps.is_available():
                device = "mps"
            else:
                device = "cpu"
                
        logger.info("loading %s onto %s", model_dir, device)
        
        # Load the saved DecidaEncModel
        model = DecidaEncModel.from_pretrained(model_dir)
        model.to(device)
        model.eval()
        
        tokenizer = AutoTokenizer.from_pretrained(tokenizer_dir(model_dir))
        # Token budgets. Defaults match how Laya-format checkpoints are trained; raising them lets long option text through
        # (see x_decida.truncation in every response for whether anything was cut).
        max_len = int(os.environ.get("DECIDA_MAX_LEN") or model.cfg.get("max_len", DEFAULT_MAX_LEN))
        ceiling = getattr(getattr(model.encoder, "config", None), "max_position_embeddings", None)
        if ceiling and max_len > ceiling:  # positions beyond the backbone's table would fail or wrap
            logger.warning("max_len %d exceeds the backbone's %d positions; using %d", max_len, ceiling, ceiling)
            max_len = ceiling
        layout = LayaLayout(tokenizer,
                            max_len=max_len,
                            head_max_len=int(os.environ.get("DECIDA_HEAD_TOKENS") or model.cfg.get("head_max_len", 192)),
                            opt_max_tokens=int(os.environ.get("DECIDA_OPTION_TOKENS") or model.cfg.get("opt_max_tokens", 48)))
        
        engine = cls(model, layout, device, dtype)
        return engine

    def warmup(self):
        pass
        
    def predict(self, req: SystemOneRequest) -> dict[str, Any]:
        # Sync wrapper around predict_async via run_until_complete if possible,
        # or just run the single-item logic directly.
        return asyncio.run(self.predict_async(req))

    def _format_ans(self, qtype_str, probs, q_criteria, noul_confidence):
        return format_answer(qtype_str, probs, q_criteria, noul_confidence)

    async def _batch_loop(self):
        while True:
            await asyncio.sleep(self.max_wait_ms / 1000.0)
            
            async with self._queue_lock:
                if not self._queue:
                    self._batch_task = None
                    return
                
                batch_items = []
                for item in list(self._queue):
                    # every request that arrived within max_wait_ms goes into this batch (max_batch_tokens is not enforced yet)
                    batch_items.append(item)
                    self._queue.remove(item)
                    
            if not batch_items:
                continue

            gpu, held = compute_lock(self.device), False
            try:
                # Encode all questions
                all_encoded = []
                metadata = []
                pad_id = self.layout.tok.pad_token_id
                max_len = 0
                max_options = 0
                
                for req, fut in batch_items:
                    state_str = json.dumps(req.state, separators=(",", ":"), ensure_ascii=False) if isinstance(req.state, (dict, list)) else str(req.state)
                    req_qids = []
                    req_tokens = 0
                    
                    for qid, q_data in req.questions.items():
                        qtype_str = q_data["type"]
                        q = CaseQuestion(
                            qid=qid,
                            primitive=Primitive(qtype_str),
                            instructions=q_data["instructions"],
                            criteria=normalize_criteria(qtype_str, q_data.get("criteria", {}))
                        )
                        encoded = self.layout.build(state_str, q)
                        max_len = max(max_len, len(encoded.input_ids))
                        max_options = max(max_options, encoded.n_options)
                        all_encoded.append((req, qid, qtype_str, q, encoded))
                        req_qids.append(qid)
                        req_tokens += len(encoded.input_ids)
                    
                    metadata.append((req, fut, req_qids, req_tokens))
                    
                gpu.acquire()   # held until the answers are resolved (released in the finally below)
                held = True
                # Create batch tensors
                n = len(all_encoded)
                ids = torch.full((n, max_len), pad_id, dtype=torch.long, device=self.device)
                att = torch.zeros((n, max_len), dtype=torch.long, device=self.device)
                mpos = torch.zeros((n, max_options), dtype=torch.long, device=self.device)
                mmask = torch.zeros((n, max_options), dtype=torch.bool, device=self.device)
                qtypes = torch.zeros(n, dtype=torch.long, device=self.device)
                
                for i, (req, qid, qtype_str, q, encoded) in enumerate(all_encoded):
                    seq_len = len(encoded.input_ids)
                    k = encoded.n_options
                    ids[i, :seq_len] = encoded.input_ids
                    att[i, :seq_len] = encoded.attention_mask
                    mpos[i, :k] = encoded.readout_positions
                    mmask[i, :k] = True
                    qtypes[i] = self.qtypes_map[q.primitive.value]
                    
                batch = Batch(
                    input_ids=ids,
                    attention_mask=att,
                    readout_positions=mpos,
                    marker_mask=mmask,
                    qtypes=qtypes
                )
                
                with torch.no_grad():
                    logits = self.model(batch)
                    logits = logits.masked_fill(~mmask, -1e4)
                    
                    # Apply calibration temp
                    temps = self.model.cfg.get("temperature", [1.0, 1.0, 1.0]) if self.model.cfg.get("calibrated", False) else [1.0, 1.0, 1.0]
                    
                    # Resolve futures
                    item_idx = 0
                    for req, fut, req_qids, req_tokens in metadata:
                        responses = {}
                        options_cut, state_cut = 0, False
                        is_calibrated = req.x_decida.get("calibrated", True) and self.model.cfg.get("calibrated", False)
                        noul_confidence = req.x_decida.get("noul_confidence", False)
                        
                        for qid in req_qids:
                            _, _, qtype_str, q, encoded = all_encoded[item_idx]
                            k = encoded.n_options
                            options_cut = max(options_cut, encoded.options_truncated)
                            state_cut = state_cut or encoded.truncated
                            
                            q_logits = logits[item_idx, :k]
                            if is_calibrated:
                                temp = temps[self.qtypes_map[q.primitive.value]]
                                q_logits = q_logits / temp
                                
                            probs = F.softmax(q_logits, dim=-1).cpu().tolist()
                            responses[qid] = self._format_ans(qtype_str, probs, q.criteria, noul_confidence)
                            
                            item_idx += 1
                            
                        fut.set_result({
                            "model": req.model,
                            "answers": responses,
                            "usage": {"input_tokens": req_tokens, "output_tokens": 0},
                            "x_decida": {"truncation": {"options_cut": options_cut, "state_cut": state_cut}},
                        })
                        
            except Exception as e: # noqa: BLE001
                import traceback
                traceback.print_exc()
                for req, fut in batch_items:
                    if not fut.done():
                        fut.set_exception(e)
            finally:
                if held:
                    gpu.release()

    async def predict_async(self, req: SystemOneRequest) -> dict[str, Any]:
        loop = asyncio.get_running_loop()
        fut = loop.create_future()
        
        async with self._queue_lock:
            self._queue.append((req, fut))
            if self._batch_task is None or self._batch_task.done():
                self._batch_task = asyncio.create_task(self._batch_loop())
                
        return await fut
