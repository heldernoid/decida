"""Multi-model store: alias -> backend, lazy loading, unloading."""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any

from decida.runtime.detect import Backend, Detection, detect
from decida.runtime.device import compute_lock, detect_device
from decida.runtime.refs import alias_for as _alias
from decida.runtime.refs import local_dir, split_ref

logger = logging.getLogger("decida.runtime")

DEFAULT_CLM_BASE = "Qwen/Qwen3-8B"
# Most options one choice question can carry per backend (lm reads one letter A-Z per option).
MAX_OPTIONS = {Backend.ENCODER: 255, Backend.CLM: 255, Backend.LM: 26, Backend.GLINER: 255, Backend.REMOTE: 255}


class ModelError(Exception):
    """Raised for unknown or unsupported models."""


@dataclass
class ModelEntry:
    name: str
    ref: str
    detection: Detection
    device: str
    dtype: str = "auto"
    status: str = "registered"  # registered | loading | ready | error
    error: str | None = None
    engine: Any = None
    loaded_at: float | None = None
    latencies_ms: list[float] = field(default_factory=list)

    def record(self, ms: float) -> None:
        self.latencies_ms.append(ms)
        del self.latencies_ms[:-500]

    def stats(self) -> dict[str, float | None]:
        xs = sorted(self.latencies_ms)
        if not xs:
            return {"avg_latency_ms": None, "p50_latency_ms": None, "p95_latency_ms": None}
        return {"avg_latency_ms": round(sum(xs) / len(xs), 2), "p50_latency_ms": round(xs[len(xs) // 2], 2),
                "p95_latency_ms": round(xs[min(len(xs) - 1, int(len(xs) * 0.95))], 2)}

    def _spend(self) -> dict[str, Any]:
        eng = self.engine
        if getattr(eng, "family", None) != "remote":
            return {}
        return {"spent_usd": round(eng.spent_usd, 6), "budget_usd": eng.budget_usd, "remote_requests": eng.requests}

    def describe(self) -> dict[str, Any]:
        d = self.detection
        return {"name": self.name, "ref": self.ref, "backend": d.backend, "family": d.backend, "device": self.device,
                "status": self.status, "loaded": self.status == "ready", "error": self.error, "license": d.license,
                "quality_mode": d.quality_mode, "calibrated": d.calibrated, "max_options": MAX_OPTIONS.get(d.backend, 255), "reason": d.reason, **self.stats(), **self._spend()}


def alias_for(ref: str) -> str:
    if ref.startswith(("http://", "https://")):
        from urllib.parse import parse_qs, urlparse

        u = urlparse(ref)
        return ((parse_qs(u.query).get("model") or [""])[0] or u.hostname or "remote").lower()
    return _alias(ref)


class ModelStore:
    def __init__(self, device: str = "auto"):
        self.device = detect_device(device)
        self.entries: dict[str, ModelEntry] = {}
        self.default: str | None = None
        self._locks: dict[str, asyncio.Lock] = {}

    def add(self, ref: str, name: str | None = None, backend: str | None = None, device: str | None = None,
            dtype: str = "auto", revision: str | None = None) -> ModelEntry:
        """Register a model (detects the backend, does not load weights)."""
        name = name or alias_for(ref)
        det = detect(ref, revision)
        if backend:
            det.backend, det.reason = backend, f"forced backend={backend}"
        if det.backend == Backend.UNSUPPORTED:
            raise ModelError(f"{ref}: {det.reason}")
        entry = ModelEntry(name, ref, det, detect_device(device or self.device), dtype)
        self.entries[name] = entry
        self.default = self.default or name
        return entry

    def get(self, name: str | None) -> ModelEntry:
        name = name or self.default
        if name is None or name not in self.entries:
            raise ModelError(f"unknown model {name!r}; available: {sorted(self.entries)}")
        return self.entries[name]

    def _load_sync(self, e: ModelEntry) -> None:
        with compute_lock(e.device):   # moving weights onto the GPU races with another model answering (see runtime/device.py)
            self._load_locked(e)

    def _load_locked(self, e: ModelEntry) -> None:
        d = e.detection
        if d.backend == Backend.ENCODER:
            from decida.serve.engine import Engine
            e.engine = Engine.load(local_dir(e.ref), device=e.device)   # from disk, or downloaded from the Hub first
        elif d.backend == Backend.LM:
            from decida.serve.lm_engine import LMEngine
            repo, folder = split_ref(e.ref)
            e.engine = LMEngine.load(str(local_dir(e.ref)) if folder else repo, device=e.device, dtype=e.dtype)
        elif d.backend == Backend.GLINER:
            from decida.serve.gliner_engine import GlinerEngine
            e.engine = GlinerEngine.load(str(local_dir(e.ref)), device=e.device)
        elif d.backend == Backend.CLM:
            from pathlib import Path

            from huggingface_hub import hf_hub_download

            from decida.serve.clm_engine import CLMEngine
            assert d.heads_file is not None   # detect() sets it for every clm checkpoint
            repo, folder = split_ref(e.ref)
            heads = str(Path(repo) / (folder or "") / d.heads_file) if Path(repo).exists() else hf_hub_download(repo, f"{folder}/{d.heads_file}" if folder else d.heads_file)
            e.engine = CLMEngine.load(d.base_model or DEFAULT_CLM_BASE, heads, device=e.device, dtype=e.dtype)
        elif d.backend == Backend.REMOTE:
            import os

            from decida.runtime.remote import (
                DEFAULT_KEY_ENV,
                DEFAULT_PRICE_PER_M_INPUT,
                RemoteEngine,
            )
            e.engine = RemoteEngine(d.extra["url"], d.extra["remote_model"], key_env=os.environ.get("DECIDA_REMOTE_KEY_ENV", DEFAULT_KEY_ENV),
                                    budget_usd=float(os.environ.get("DECIDA_REMOTE_BUDGET_USD", "1.0")),
                                    price_per_m_input=float(os.environ.get("DECIDA_REMOTE_PRICE_PER_M", DEFAULT_PRICE_PER_M_INPUT)))
        else:
            raise ModelError(f"{e.ref}: backend {d.backend} cannot be loaded")

    async def ensure_loaded(self, name: str | None) -> ModelEntry:
        e = self.get(name)
        if e.status == "ready":
            return e
        lock = self._locks.setdefault(e.name, asyncio.Lock())
        async with lock:
            if e.status == "ready":
                return e
            e.status, e.error = "loading", None
            t0 = time.time()
            try:
                await asyncio.to_thread(self._load_sync, e)
            except Exception as exc:
                e.status, e.error = "error", str(exc)
                logger.exception("failed to load %s", e.name)
                raise
            e.status, e.loaded_at = "ready", time.time()
            logger.info("loaded %s (%s) in %.1fs", e.name, e.detection.backend, time.time() - t0)
        return e

    def unload(self, name: str) -> None:
        e = self.get(name)
        device, e.engine, e.status = e.device, None, "registered"
        import gc
        gc.collect()
        # Dropping the Python references only frees memory into torch's own caching allocator, which keeps it for
        # reuse within the process rather than returning it to the OS/driver - nvidia-smi, rocm-smi and Activity
        # Monitor all keep reporting the old usage until the cache itself is released.
        if device == "cuda":
            import torch
            torch.cuda.empty_cache()
        elif device == "mps":
            import torch
            torch.mps.empty_cache()

    def remove(self, name: str) -> None:
        self.unload(name)
        del self.entries[name]
        if self.default == name:
            self.default = next(iter(self.entries), None)
