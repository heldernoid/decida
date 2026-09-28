"""GLiNER2.5-Decide / GLiNER2.5-multi-Decide engine: every question in a request goes through one padded batch and
one encoder forward pass (`GlinerModel.score_many`), the same batching the encoder engine already does. Structured
otherwise like `serve/lm_engine.py`: a single lock, `format_answer`/`normalize_criteria` shared with every other
local engine so the response shape is identical regardless of backend."""
import asyncio
import time
from typing import Any

from decida.model.gliner_enc import GlinerModel, labels_for
from decida.runtime.device import compute_lock
from decida.serve.engine import SystemOneRequest, format_answer, normalize_criteria

PROMPT_VERSION = "gliner-markers-v1"


class GlinerEngine:
    family = "gliner"

    def __init__(self, model: GlinerModel, device: str, model_id: str = "gliner"):
        self.model, self.device, self.model_id = model, device, model_id
        self._lock = asyncio.Lock()

    @classmethod
    def load(cls, model_dir: str, device: str = "auto", max_len: int | None = None) -> "GlinerEngine":
        if device == "auto":
            import torch
            device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
        kwargs = {"max_len": max_len} if max_len else {}
        model = GlinerModel.from_pretrained(model_dir, **kwargs).to(device).eval()
        return cls(model, device, model_id=model_dir)

    def predict_sync(self, req: SystemOneRequest) -> dict[str, Any]:
        with compute_lock(self.device):   # one model on the GPU at a time (see runtime/device.py)
            return self._predict_unlocked(req)

    def _predict_unlocked(self, req: SystemOneRequest) -> dict[str, Any]:
        noul_conf = bool(req.x_decida.get("noul_confidence", False))
        qids = list(req.questions)
        parsed = [(q["type"], normalize_criteria(q["type"], q.get("criteria", {}))) for q in req.questions.values()]
        items = [(req.questions[qid]["instructions"], labels_for(t, criteria)) for qid, (t, criteria) in zip(qids, parsed)]
        results = self.model.score_many(req.state, items)  # every question in one padded batch, one forward pass
        answers = {qid: format_answer(t, probs, criteria, noul_conf) for qid, (t, criteria), (probs, _) in zip(qids, parsed, results)}
        tokens = sum(n for _, n in results)
        return {"model": req.model, "answers": answers, "usage": {"input_tokens": tokens, "output_tokens": 0}}

    async def predict_async(self, req: SystemOneRequest) -> dict[str, Any]:
        async with self._lock:  # one forward at a time: MPS aborts on concurrent inference, same as the LM engine
            start = time.perf_counter()
            resp = await asyncio.to_thread(self.predict_sync, req)
            resp["x_decida"] = {"prompt_version": PROMPT_VERSION, "engine_seconds": round(time.perf_counter() - start, 4), "model_id": self.model_id}
            return resp
