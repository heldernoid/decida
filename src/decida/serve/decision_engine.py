"""Engine for the DecidaBERT-large-v1.1 / -v2 format (`model/decision_enc.py`): a request's state and its questions
are one sequence, read in one forward pass. Structured like `serve/gliner_engine.py` (one lock, one request at a time),
with `format_answer`/`normalize_criteria` shared with every other local engine so the response shape is the same.

A request of more than five questions, or one whose questions do not fit beside the state, is read in several passes
(`x_decida.passes`), each with the state and at most five questions, batched on the GPU (see model/decision_enc.py).
`probabilities` are the model's raw distribution; `confidence` is the top answer's probability after the per-type
temperature in the checkpoint's `decision_config.json`, so 0.8 means right about 80% of the time on held-out data."""
import asyncio
import time
from typing import Any

from decida.model.decision_enc import DecisionModel
from decida.runtime.device import compute_lock
from decida.serve.engine import SystemOneRequest, format_answer, normalize_criteria

PROMPT_VERSION = "decision-one-pass-v1"


class DecisionEngine:
    family = "decision"

    def __init__(self, model: DecisionModel, device: str, model_id: str = "decision"):
        self.model, self.device, self.model_id = model, device, model_id
        self._lock = asyncio.Lock()

    @classmethod
    def load(cls, model_dir: str, device: str = "auto") -> "DecisionEngine":
        if device == "auto":
            import torch
            device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
        model = DecisionModel.from_pretrained(model_dir).to(device).eval()
        return cls(model, device, model_id=model_dir)

    def predict_sync(self, req: SystemOneRequest) -> dict[str, Any]:
        with compute_lock(self.device):   # one model on the GPU at a time (see runtime/device.py)
            return self._predict_unlocked(req)

    def _predict_unlocked(self, req: SystemOneRequest) -> dict[str, Any]:
        questions = {qid: {**q, "criteria": normalize_criteria(q["type"], q.get("criteria"))} for qid, q in req.questions.items()}
        answers, encs = self.model.predict(req.state, questions)
        out = {}
        for qid, a in answers.items():
            ans = format_answer(a.type, a.probs, questions[qid].get("criteria"), noul_confidence=False)
            ans["confidence"] = a.confidence
            out[qid] = ans
        return {"model": req.model, "answers": out,
                "usage": {"input_tokens": sum(len(e.input_ids) for e in encs), "output_tokens": 0},
                "x_decida": {"truncation": {"options_cut": sum(e.options_cut for e in encs),
                                            "state_cut": any(e.state_cut for e in encs)},
                             "passes": len(encs)}}

    def predict(self, req: SystemOneRequest) -> dict[str, Any]:
        return self.predict_sync(req)

    async def predict_async(self, req: SystemOneRequest) -> dict[str, Any]:
        async with self._lock:  # one forward at a time: MPS aborts on concurrent inference
            start = time.perf_counter()
            resp = await asyncio.to_thread(self.predict_sync, req)
            resp["x_decida"].update(prompt_version=PROMPT_VERSION, engine_seconds=round(time.perf_counter() - start, 4),
                                    model_id=self.model_id)
            return resp
