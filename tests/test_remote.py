"""The remote backend against a local fake endpoint (the real API is never called from tests)."""
import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import ClassVar

import pytest

from decida.runtime.detect import Backend, detect
from decida.runtime.remote import RemoteEngine, RemoteError
from decida.runtime.store import ModelStore, alias_for
from decida.serve.engine import SystemOneRequest

SECRET = "sk-test-secret-123"


class Fake(BaseHTTPRequestHandler):
    seen: ClassVar[list] = []
    mode = "ok"

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        Fake.seen.append({"auth": self.headers.get("Authorization"), "body": body})
        if Fake.mode == "401":
            self.send_response(401); self.end_headers(); self.wfile.write(f"bad key {SECRET}".encode()); return
        out = {"model": body["model"], "answers": {"q": {"type": "noul", "noul": 0.9}}, "usage": {"input_tokens": 1_000_000, "output_tokens": 0}}
        data = json.dumps(out).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(data)

    def log_message(self, *a):
        pass


@pytest.fixture()
def server():
    Fake.seen, Fake.mode = [], "ok"
    srv = HTTPServer(("127.0.0.1", 0), Fake)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}/v1/systemone"
    srv.shutdown()


def req():
    return SystemOneRequest({"model": "jev", "state": "s", "questions": {"q": {"type": "noul", "instructions": "ok?"}}})


def test_forwards_body_with_bearer_key_and_meters_spend(server, monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", SECRET)
    eng = RemoteEngine(server, "jev-latest", budget_usd=1.0, price_per_m_input=0.5)
    resp = asyncio.run(eng.predict_async(req()))
    assert Fake.seen[0]["auth"] == f"Bearer {SECRET}"
    assert Fake.seen[0]["body"] == {"model": "jev-latest", "state": "s", "questions": {"q": {"type": "noul", "instructions": "ok?"}}}
    assert resp["model"] == "jev" and resp["answers"]["q"]["noul"] == 0.9
    assert resp["x_decida"]["remote"] is True and resp["x_decida"]["spent_usd"] == 0.5
    assert SECRET not in json.dumps(resp)


def test_budget_stops_requests(server, monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", SECRET)
    eng = RemoteEngine(server, "jev-latest", budget_usd=0.5, price_per_m_input=0.5)  # one request spends exactly the cap
    asyncio.run(eng.predict_async(req()))
    with pytest.raises(RemoteError) as e:
        asyncio.run(eng.predict_async(req()))
    assert e.value.status == 402 and "budget" in str(e.value)
    assert len(Fake.seen) == 1, "the second request must not reach the endpoint"


def test_missing_key_and_error_bodies_never_leak_the_key(server, monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    eng = RemoteEngine(server, "jev-latest")
    with pytest.raises(RemoteError) as e:
        asyncio.run(eng.predict_async(req()))
    assert e.value.status == 401 and not Fake.seen
    monkeypatch.setenv("TYPESAFE_API_KEY", SECRET)
    Fake.mode = "401"
    with pytest.raises(RemoteError) as e:
        asyncio.run(eng.predict_async(req()))
    assert e.value.status == 401 and SECRET not in str(e.value) and "<redacted>" in str(e.value)


def test_detect_and_alias_for_urls():
    d = detect("https://api.typesafe.ai/v1/systemone?model=jev-latest")
    assert d.backend == Backend.REMOTE and d.extra == {"url": "https://api.typesafe.ai/v1/systemone", "remote_model": "jev-latest"}
    assert detect("https://api.typesafe.ai/v1/systemone").extra["remote_model"] == "jev-latest"
    assert detect("http://example.com/v1/systemone").backend == Backend.UNSUPPORTED  # key must not travel unencrypted
    assert detect("http://127.0.0.1:9/v1/systemone").backend == Backend.REMOTE
    assert alias_for("https://api.typesafe.ai/v1/systemone?model=Jev-Latest") == "jev-latest"


def test_store_serves_remote_and_reports_spend(server, monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", SECRET)
    monkeypatch.setenv("DECIDA_REMOTE_BUDGET_USD", "1.0")
    monkeypatch.setenv("DECIDA_REMOTE_PRICE_PER_M", "0.25")
    store = ModelStore("cpu")
    store.add(server, name="jev")

    async def go():
        e = await store.ensure_loaded("jev")
        await e.engine.predict_async(req())
        return e.describe()

    d = asyncio.run(go())
    assert d["backend"] == "remote" and d["quality_mode"] == "hosted (third-party)"
    assert d["spent_usd"] == 0.25 and d["budget_usd"] == 1.0 and d["remote_requests"] == 1 and d["max_options"] == 255
