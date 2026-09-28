import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from decida.runtime.detect import Backend
from decida.runtime.device import device_info
from decida.runtime.remote import RemoteError
from decida.runtime.store import ModelEntry, ModelError, ModelStore
from decida.serve.data_api import router as data_router
from decida.serve.engine import SystemOneRequest, coerce_for_local

logger = logging.getLogger("decida.serve")
store: ModelStore = ModelStore()
WEB_DIR = Path(__file__).resolve().parent.parent / "web"


def parse_model_specs(spec: str) -> list[tuple[str | None, str]]:
    """'alias=ref;ref2' (as set by the CLI in DECIDA_MODELS) -> [(alias|None, ref)]."""
    out = []
    for part in filter(None, (p.strip() for p in spec.split(";"))):
        alias, sep, ref = part.partition("=")
        out.append((alias, ref) if sep and "/" not in alias else (None, part))
    return out


@asynccontextmanager
async def lifespan(app: FastAPI):
    global store
    store = ModelStore(os.environ.get("DECIDA_DEVICE", "auto"))
    dtype = os.environ.get("DECIDA_LM_DTYPE", "auto")
    backend = os.environ.get("DECIDA_BACKEND") or None
    for alias, ref in parse_model_specs(os.environ.get("DECIDA_MODELS", "")):
        store.add(ref, name=alias, backend=backend, dtype=dtype)
    logger.info("Decida API on %s with models %s", store.device, list(store.entries))
    if os.environ.get("DECIDA_PRELOAD", "1") == "1":
        for name in list(store.entries):
            await store.ensure_loaded(name)
    yield
    logger.info("Shutting down Decida API")


app = FastAPI(title="Decida API", version="0.1.0", lifespan=lifespan)


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    return JSONResponse(status_code=422, content={"error": {"type": "validation_error", "message": str(exc), "field": "unknown"}})


@app.exception_handler(ModelError)
async def model_error_handler(request: Request, exc: ModelError):
    return JSONResponse(status_code=404, content={"error": {"type": "model_error", "message": str(exc), "models": sorted(store.entries)}})


@app.exception_handler(RemoteError)
async def remote_error_handler(request: Request, exc: RemoteError):
    return JSONResponse(status_code=exc.status, content={"error": {"type": "remote_error", "message": str(exc)}})


GENERIC_NAMES = {"", "default", "latest"}  # and anything starting with "decida": what Jev/laya-shaped clients and the MCP server send


def resolve(requested: str | None) -> str | None:
    """An exact alias always wins. Only generic names (no name, "default", "latest", "decida…") fall back to the default model;
    any other unknown name is a 404, so a benchmark can never silently run on a different model than the one it asked for."""
    if requested in store.entries:
        return requested
    if requested is None or requested in GENERIC_NAMES or str(requested).startswith("decida"):
        return store.default
    return requested  # unknown: the store raises ModelError, which the API turns into a 404 listing the loaded models


async def _answer(entry: ModelEntry, body: dict[str, Any]) -> dict[str, Any]:
    """One request answered by one model, with the timing and model fields every response carries."""
    if entry.detection.backend != Backend.REMOTE:  # hosted endpoints take structured values as they are
        body = coerce_for_local(body)
    req = SystemOneRequest({**body, "model": entry.name})
    start = time.time()
    resp = await entry.engine.predict_async(req)
    latency_ms = round((time.time() - start) * 1000, 2)
    entry.record(latency_ms)
    x = resp.setdefault("x_decida", {})
    x.update(latency_ms=latency_ms, model_family=entry.detection.backend, compute_tokens=resp["usage"]["input_tokens"],
             quality_mode=entry.detection.quality_mode, calibrated=entry.detection.calibrated, device=entry.device)
    resp["latency_ms"] = latency_ms  # laya-api-compatible top-level field
    return resp


@app.post("/v1/systemone")
async def systemone(body: dict):
    entry = await store.ensure_loaded(resolve(body.get("model")))
    return JSONResponse(content=await _answer(entry, body))


MAX_BATCH = 256


@app.post("/v1/systemone/batch")
async def systemone_batch(body: dict[str, Any]):
    """Many independent requests to one model in one HTTP call, answered concurrently: {model, requests: [{state, questions}, ...]}.
    Browsers open only a handful of connections at once, so fifty separate calls queue in waves; this is one. A request that fails
    (bad question, budget) comes back as {"error": {"message"}} in its slot and does not fail the others."""
    items = body.get("requests")
    if not isinstance(items, list) or not 1 <= len(items) <= MAX_BATCH:
        raise ValueError(f"requests must be a list of 1-{MAX_BATCH} requests")
    entry = await store.ensure_loaded(resolve(body.get("model")))

    async def one(item: Any) -> dict[str, Any]:
        try:
            if not isinstance(item, dict):
                raise TypeError("each request must be an object")
            return await _answer(entry, item)
        except (ValueError, TypeError, RemoteError, ModelError) as exc:
            return {"error": {"message": str(exc)}}

    start = time.time()
    results = await asyncio.gather(*(one(i) for i in items))
    return JSONResponse(content={"model": entry.name, "responses": results, "latency_ms": round((time.time() - start) * 1000, 2)})


@app.post("/v1/check")
async def check(body: dict):
    """Run the 14 smoke checks against one model (see decida.checks)."""
    from decida.checks import run_checks
    entry = await store.ensure_loaded(resolve(body.get("model")))

    async def predict(req: dict) -> dict:
        return await entry.engine.predict_async(SystemOneRequest({**req, "model": entry.name}))

    return JSONResponse(content={"model": entry.name, **await run_checks(predict)})


@app.get("/health")
@app.get("/healthz")
async def healthz():
    ready = [e.name for e in store.entries.values() if e.status == "ready"]
    if store.entries and not ready and any(e.status == "loading" for e in store.entries.values()):
        return JSONResponse(status_code=503, content={"status": "loading"})
    return JSONResponse(content={"status": "ok", "models_loaded": len(ready), "models": sorted(store.entries), "device": store.device})


@app.get("/v1/models")
async def models():
    return JSONResponse(content={"default": store.default, "models": [e.describe() for e in store.entries.values()]})


@app.post("/v1/models")
async def add_model(body: dict):
    entry = store.add(body["ref"], name=body.get("name"), backend=body.get("backend"), device=body.get("device"), dtype=body.get("dtype", "auto"))
    if body.get("load", True):
        await store.ensure_loaded(entry.name)
    return JSONResponse(content=entry.describe())


@app.delete("/v1/models/{name}")
async def delete_model(name: str):
    store.remove(name)
    return JSONResponse(content={"removed": name})


@app.get("/v1/device")
async def device():
    return JSONResponse(content=device_info(store.device))


def _queue_depth() -> int:
    return sum(len(getattr(e.engine, "_queue", [])) for e in store.entries.values() if e.engine is not None)


@app.get("/metrics")
async def metrics():
    lines = ["# TYPE decida_queue_depth gauge", f"decida_queue_depth {_queue_depth()}"]
    for e in store.entries.values():
        s = e.stats()
        if s["p50_latency_ms"] is not None:
            lines.append(f'decida_latency_p50_ms{{model="{e.name}"}} {s["p50_latency_ms"]}')
            lines.append(f'decida_latency_p95_ms{{model="{e.name}"}} {s["p95_latency_ms"]}')
    return "\n".join(lines) + "\n"


NO_CACHE = {"Cache-Control": "no-cache"}  # UI files change between versions: browsers must revalidate, never reuse a stale module


class NoCacheStatic(StaticFiles):
    async def get_response(self, path, scope):
        resp = await super().get_response(path, scope)
        resp.headers["Cache-Control"] = "no-cache"
        return resp


app.include_router(data_router)

PAGES = ("/", "/models", "/playground", "/testbench", "/api")   # the home page shows one section per URL; keep in step with its nav


@app.get("/", include_in_schema=False)
@app.get("/models", include_in_schema=False)
@app.get("/playground", include_in_schema=False)
@app.get("/testbench", include_in_schema=False)
@app.get("/api", include_in_schema=False)
async def home():
    return FileResponse(WEB_DIR / "index.html", headers=NO_CACHE)


def list_benches() -> list[dict]:
    """Benches are folders under web/bench/<id>/ holding index.html and an optional bench.json (title, description, tags)."""
    out = []
    for d in sorted((WEB_DIR / "bench").glob("*/index.html")) if (WEB_DIR / "bench").is_dir() else []:
        meta_file = d.parent / "bench.json"
        meta = json.loads(meta_file.read_text()) if meta_file.exists() else {}
        if meta.get("hidden"):   # still served at its URL, just not listed
            continue
        out.append({"id": d.parent.name, "title": meta.get("title", d.parent.name), "description": meta.get("description", ""),
                    "tags": meta.get("tags", []), "url": f"/bench/{d.parent.name}/"})
    return out


@app.get("/v1/benches")
async def benches():
    return JSONResponse(content={"benches": list_benches()})


if (WEB_DIR / "bench").is_dir():
    app.mount("/bench", NoCacheStatic(directory=WEB_DIR / "bench", html=True), name="bench")
