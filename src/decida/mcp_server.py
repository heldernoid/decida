"""Minimal MCP server (stdio, newline-delimited JSON-RPC 2.0) exposing Decida decisions as tools.

Zero third-party dependencies. It is a thin client of a running `decida serve` (or any /v1/systemone server). Which
one: DECIDA_URL wins if set; otherwise the host:port of whichever `decida serve` last started and is still running
(`settings.write_running`/`read_running`, since `--port` is never written to settings.json and so would otherwise
be untraceable once anything other than the default port is used); otherwise `decida serve`'s own default port.
Question wording is shared with the eval suite families.
"""
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date
from typing import Any

from decida.mcp_templates import (
    AS_OF,
    DEP_QUESTIONS,
    GATE_QUESTIONS,
    TRIAGE_QUESTIONS,
    choice_question,
)

PROTOCOL = "2024-11-05"


def resolve_url() -> str:
    """Resolved fresh on every call (not cached at import), so a `decida serve` restarted on a different port after
    `decida mcp` started is still found on the next call, with no env var and no restart of `decida mcp` needed."""
    env = os.environ.get("DECIDA_URL")
    if env:
        base = env
    else:
        from decida.settings import read_running
        running = read_running()
        base = f"http://{running[0]}:{running[1]}" if running else "http://localhost:8000"
    return base.rstrip("/") + "/v1/systemone"


def _decide(state: Any, questions: dict) -> dict:
    """The full /v1/systemone response (not just its answers): every tool below reports back which model actually
    answered ("decida" in the request always resolves to the server's current default, see MCP.md), so the caller
    is never left guessing which model produced a result."""
    body = json.dumps({"model": "decida", "state": state, "questions": questions}).encode()
    req = urllib.request.Request(resolve_url(), body, {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def _gate(resp: dict) -> dict:
    a = resp["answers"]
    ans = a["recommended_gate"]
    return {"gate": ans["choice"], "probabilities": ans["probabilities"], "is_dangerous": a["is_dangerous"]["noul"],
            "expected_severity": a["severity"]["score"], "model": resp["model"]}


def _pypi_lookup(name: str) -> dict | None:
    """Metadata snapshot from the PyPI JSON API (None when the package does not exist)."""
    try:
        with urllib.request.urlopen(f"https://pypi.org/pypi/{name}/json", timeout=20) as r:
            d = json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    firsts = [f["upload_time_iso_8601"][:10] for fs in d["releases"].values() for f in fs]
    info = d["info"]
    return {"name": info["name"], "latest_version": info["version"], "first_release": min(firsts) if firsts else None, "release_count": len(d["releases"]),
            "summary": (info.get("summary") or "")[:140], "has_project_urls": bool(info.get("project_urls") or info.get("home_page")), "yanked_latest": bool(info.get("yanked"))}


def gate_tool_call(args: dict) -> dict:
    state = {"environment": args.get("environment", "local"), "user_request": args.get("user_request", ""),
             "proposed_tool_call": args["tool_call"], "agent_reasoning": args.get("agent_reasoning", "")}
    return _gate(_decide(state, GATE_QUESTIONS))


def vet_dependency(args: dict) -> dict:
    meta = _pypi_lookup(args["package"])  # live registry lookup; the model only judges the snapshot
    reg = {"status": 404, "detail": "Not Found"} if meta is None else {**meta, "age_days": (AS_OF - date.fromisoformat(meta["first_release"])).days if meta.get("first_release") else None}
    state = {"ecosystem": "pypi", "as_of": AS_OF.isoformat(), "proposed_command": f"pip install {args['package']}",
             "team_policy": f"Packages must have been on PyPI for at least {args.get('min_age_days', 14)} days.", "registry_lookup": reg}
    resp = _decide(state, DEP_QUESTIONS)
    a = resp["answers"]
    return {"gate": a["gate"]["choice"], "probabilities": a["gate"]["probabilities"], "registry": reg, "model": resp["model"]}


def triage_failure(args: dict) -> dict:
    resp = _decide({"ci_job": args.get("job", "tests"), "command": args.get("command", ""), "log": args["log"]}, TRIAGE_QUESTIONS)
    a = resp["answers"]
    return {"category": a["category"]["choice"], "probabilities": a["category"]["probabilities"],
            "retry_worthwhile": a["retry_worthwhile"]["noul"], "needs_code_change": a["needs_code_change"]["noul"], "model": resp["model"]}


def classify_text(args: dict) -> dict:
    resp = _decide({"text": args["text"]}, {"label": choice_question(args.get("instructions", "Which category fits the text best?"), args["labels"])})
    a = resp["answers"]
    return {"label": a["label"]["choice"], "probabilities": a["label"]["probabilities"], "model": resp["model"]}


def decide(args: dict) -> dict:
    return _decide(args["state"], args["questions"])


_OBJ = "object"
TOOLS = {
    "gate_tool_call": (gate_tool_call, "Decide allow / confirm / block for a proposed agent tool call before running it.",
                       {"type": _OBJ, "required": ["tool_call"], "properties": {
                           "tool_call": {"type": "string"}, "environment": {"enum": ["local", "staging", "production"]},
                           "user_request": {"type": "string"}, "agent_reasoning": {"type": "string"}}}),
    "vet_dependency": (vet_dependency, "Check a PyPI package before installing it (existence, age policy).",
                       {"type": _OBJ, "required": ["package"], "properties": {"package": {"type": "string"}, "min_age_days": {"type": "integer"}}}),
    "triage_failure": (triage_failure, "Classify a failing test/CI log: code bug, missing dependency, test setup, environment, flaky.",
                       {"type": _OBJ, "required": ["log"], "properties": {"log": {"type": "string"}, "command": {"type": "string"}}}),
    "classify_text": (classify_text, "Classify text into one of the given labels (label -> description).",
                      {"type": _OBJ, "required": ["text", "labels"], "properties": {
                          "text": {"type": "string"}, "labels": {"type": _OBJ}, "instructions": {"type": "string"}}}),
    "decide": (decide, "Raw /v1/systemone call: any state plus typed questions (choice / score / noul) -> probabilities.",
               {"type": _OBJ, "required": ["state", "questions"], "properties": {"state": {}, "questions": {"type": _OBJ}}}),
}


def handle(msg: dict) -> dict | None:
    """Return the JSON-RPC response for a request, or None for notifications."""
    mid, method = msg.get("id"), msg.get("method")
    if mid is None:
        return None
    try:
        if method == "initialize":
            result = {"protocolVersion": PROTOCOL, "capabilities": {"tools": {}}, "serverInfo": {"name": "decida", "version": "0.1"}}
        elif method == "tools/list":
            result = {"tools": [{"name": n, "description": d, "inputSchema": s} for n, (_, d, s) in TOOLS.items()]}
        elif method == "tools/call":
            p = msg["params"]
            try:
                out = TOOLS[p["name"]][0](p.get("arguments", {}))
                result = {"content": [{"type": "text", "text": json.dumps(out)}]}
            except Exception as e:  # noqa: BLE001 - tool errors are reported in-band per MCP
                result = {"content": [{"type": "text", "text": f"decida error: {e}"}], "isError": True}
        elif method == "ping":
            result = {}
        else:
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"unknown method {method}"}}
    except Exception as e:  # noqa: BLE001
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32603, "message": str(e)}}
    return {"jsonrpc": "2.0", "id": mid, "result": result}


def main() -> None:
    for line in sys.stdin:
        if line.strip():
            resp = handle(json.loads(line))
            if resp is not None:
                sys.stdout.write(json.dumps(resp) + "\n")
                sys.stdout.flush()


if __name__ == "__main__":
    main()
