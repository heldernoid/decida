"""Two models must never touch the Apple GPU at the same time: PyTorch's MPS backend crashes the whole process when they do."""
import threading
import time

from decida.runtime import device as dev
from decida.serve import clm_engine, engine, lm_engine
from decida.serve.engine import SystemOneRequest
from decida.serve.lm_engine import LMEngine


def _owned() -> bool:
    """Does this thread hold the shared GPU lock? (RLock has no public way to ask.)"""
    return getattr(dev._MPS_LOCK, "_is_owned")()  # noqa: B009


def test_one_shared_lock_for_all_mps_devices_and_none_elsewhere():
    assert dev.compute_lock("mps") is dev.compute_lock("mps:0") is dev._MPS_LOCK
    assert dev.compute_lock("cpu") is dev.compute_lock("cuda") is dev._NO_LOCK
    with dev.compute_lock("cpu"), dev.compute_lock("cpu"):   # never blocks
        pass
    with dev.compute_lock("mps"), dev.compute_lock("mps"):   # re-entrant: nested use does not deadlock
        pass


def test_the_lock_really_excludes_other_threads():
    order = []

    def worker(name, hold):
        with dev.compute_lock("mps"):
            order.append(f"{name}-in")
            time.sleep(hold)
            order.append(f"{name}-out")

    a = threading.Thread(target=worker, args=("a", 0.15)); b = threading.Thread(target=worker, args=("b", 0.0))
    a.start(); time.sleep(0.03); b.start(); a.join(); b.join()
    assert order == ["a-in", "a-out", "b-in", "b-out"], order


def test_lm_engine_holds_the_lock_while_it_computes(monkeypatch):
    seen = {}
    e = object.__new__(LMEngine)
    e.device = "mps"
    monkeypatch.setattr(LMEngine, "_predict_unlocked", lambda self, req: seen.setdefault("held", _owned()) or {"ok": 1})
    LMEngine.predict_sync(e, SystemOneRequest({"model": "m", "state": "s", "questions": {"q": {"type": "noul", "instructions": "?"}}}))
    assert seen["held"] is True
    assert not _owned(), "and lets go afterwards"


def test_every_engine_and_the_loader_use_the_lock():
    import inspect

    from decida.runtime import store
    assert "compute_lock" in inspect.getsource(engine.Engine._batch_loop)
    assert "compute_lock" in inspect.getsource(lm_engine.LMEngine.predict_sync)
    assert "compute_lock" in inspect.getsource(clm_engine.CLMEngine.predict_sync)
    assert "compute_lock" in inspect.getsource(store.ModelStore._load_sync)
