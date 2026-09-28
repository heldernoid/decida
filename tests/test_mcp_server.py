import json

from decida import mcp_server
from decida import settings as S
from decida.settings import ServerSettings


def test_url_resolution_env_then_running_marker_then_default_port(monkeypatch, tmp_path):
    """DECIDA_URL always wins; with nothing set, decida mcp finds whichever decida serve is actually running (not
    just the default port) via the marker file that serve writes on start; with neither, it falls back to serve's
    own default port. A prior mismatch (8021 vs serve's 8000) would have failed the last of these."""
    monkeypatch.delenv("DECIDA_URL", raising=False)
    monkeypatch.setenv("DECIDA_HOME", str(tmp_path))
    assert mcp_server.resolve_url() == f"http://localhost:{ServerSettings.model_fields['port'].default}/v1/systemone"

    S.write_running("127.0.0.1", 8010)  # as if `decida serve --port 8010` were running right now (our own pid: always "alive")
    assert mcp_server.resolve_url() == "http://127.0.0.1:8010/v1/systemone"

    monkeypatch.setenv("DECIDA_URL", "http://example.internal:9999")
    assert mcp_server.resolve_url() == "http://example.internal:9999/v1/systemone", "an explicit DECIDA_URL always wins"


def test_running_marker_ignores_a_dead_process(monkeypatch, tmp_path):
    monkeypatch.delenv("DECIDA_URL", raising=False)
    monkeypatch.setenv("DECIDA_HOME", str(tmp_path))
    S.running_path().write_text('{"host": "127.0.0.1", "port": 8010, "pid": 999999999}')  # a pid nothing uses
    assert S.read_running() is None
    assert mcp_server.resolve_url() == f"http://localhost:{ServerSettings.model_fields['port'].default}/v1/systemone"


def test_initialize_and_list():
    r = mcp_server.handle({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
    assert r["result"]["serverInfo"]["name"] == "decida"
    names = {t["name"] for t in mcp_server.handle({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})["result"]["tools"]}
    assert {"gate_tool_call", "vet_dependency", "triage_failure", "classify_text", "decide"} <= names


def test_notification_gets_no_reply():
    assert mcp_server.handle({"jsonrpc": "2.0", "method": "notifications/initialized"}) is None


def test_call_uses_model_and_reports_errors(monkeypatch):
    def fake(state, questions):
        assert state["proposed_tool_call"] == "rm -rf /"
        return {"model": "decidabert", "answers": {"recommended_gate": {"choice": "block", "probabilities": {"block": 0.9}}, "is_dangerous": {"noul": 0.8}, "severity": {"score": 1.9}}}
    monkeypatch.setattr(mcp_server, "_decide", fake)
    r = mcp_server.handle({"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                           "params": {"name": "gate_tool_call", "arguments": {"tool_call": "rm -rf /"}}})
    out = json.loads(r["result"]["content"][0]["text"])
    assert out["gate"] == "block" and out["model"] == "decidabert", "the tool reports which model actually answered"
    bad = mcp_server.handle({"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "gate_tool_call", "arguments": {}}})
    assert bad["result"]["isError"]
