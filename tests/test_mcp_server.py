import json

from decida import mcp_server


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
        return {"recommended_gate": {"choice": "block", "probabilities": {"block": 0.9}}, "is_dangerous": {"noul": 0.8}, "severity": {"score": 1.9}}
    monkeypatch.setattr(mcp_server, "_decide", fake)
    r = mcp_server.handle({"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                           "params": {"name": "gate_tool_call", "arguments": {"tool_call": "rm -rf /"}}})
    assert json.loads(r["result"]["content"][0]["text"])["gate"] == "block"
    bad = mcp_server.handle({"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "gate_tool_call", "arguments": {}}})
    assert bad["result"]["isError"]
