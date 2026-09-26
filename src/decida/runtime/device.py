"""Device auto-detection (cuda -> mps -> cpu)."""
from __future__ import annotations

import threading
from typing import Any, Self


def detect_device(preferred: str = "auto") -> str:
    """Resolve 'auto' to the best available torch device; explicit values pass through."""
    if preferred != "auto":
        return preferred
    import torch

    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def device_info(device: str | None = None) -> dict[str, Any]:
    """Describe the device: name and memory (best effort; fields may be None)."""
    import torch

    dev = detect_device(device or "auto")
    info: dict[str, Any] = {"device": dev, "name": dev, "memory_total_mb": None, "memory_used_mb": None}
    if dev == "cuda":
        props = torch.cuda.get_device_properties(0)
        info.update(name=props.name, memory_total_mb=props.total_memory // 2**20,
                    memory_used_mb=torch.cuda.memory_allocated() // 2**20)
    elif dev == "mps":
        try:
            import subprocess
            total = int(subprocess.check_output(["sysctl", "-n", "hw.memsize"]).strip()) // 2**20
            info.update(name="Apple GPU (MPS)", memory_total_mb=total,
                        memory_used_mb=torch.mps.current_allocated_memory() // 2**20)
        except Exception:  # noqa: BLE001
            info["name"] = "Apple GPU (MPS)"
    return info


class _NoLock:
    """For devices where concurrent inference is safe: a lock that never blocks."""

    def acquire(self, *a: Any, **k: Any) -> bool:
        return True

    def release(self) -> None:
        pass

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc: object) -> None:
        return None


# PyTorch's Apple-GPU (MPS) backend keeps a process-wide shader cache that is not thread-safe: two models running (or one loading
# while another answers) on different threads crashes the whole server with a segmentation fault. Every engine takes this lock
# around its GPU work. Re-entrant, so nested use is fine.
_MPS_LOCK = threading.RLock()
_NO_LOCK = _NoLock()


def compute_lock(device: Any) -> Any:
    """The lock to hold while touching `device`: one shared lock for MPS, none for cpu and cuda."""
    return _MPS_LOCK if str(device).startswith("mps") else _NO_LOCK
