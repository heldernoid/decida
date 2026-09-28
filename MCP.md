# Decida over MCP

`decida mcp` is a stdio JSON-RPC 2.0 server ([MCP](https://modelcontextprotocol.io)) that exposes a running `decida
serve` as tools for a coding agent. It has zero third-party dependencies (`src/decida/mcp_server.py`) and is a thin
client of `/v1/systemone`: it does no work of its own, just shapes each tool's arguments into a typed-decision
request and forwards it.

## Prerequisites

A `decida serve` must already be running. `decida mcp` finds it automatically, in this order:

1. `DECIDA_URL`, if set (e.g. `http://localhost:8010`) — always wins.
2. Otherwise, the host:port of whichever `decida serve` last started and is still running. `decida serve` records
   this in `~/.decida/running.json` on startup (`settings.write_running`); a stale entry left by a process that has
   since exited is ignored. This is what makes `decida mcp` work with no configuration even when `serve` is not on
   its default port — `--port` is never written to `settings.json`, so without this it would be untraceable.
3. Otherwise, `decida serve`'s own default port, `http://localhost:8000`.

In practice: on one machine with one `decida serve` running, you never need to set anything. `DECIDA_URL` exists
for a remote server, several local servers where you want a specific one, or a client (like a browser-based MCP
Inspector) that does not reliably forward your shell's exported environment to the subprocess it launches — some
versions of MCP Inspector have their own separate "Environment Variables" field in the connection UI for exactly
this; if `decida mcp` still fails to connect after exporting `DECIDA_URL` in your shell, check there first.

## It is not an interactive command

`decida mcp` prints nothing and appears to hang when run bare in a terminal — that is correct. It blocks on
`sys.stdin` waiting for JSON-RPC requests from an MCP client; anything it printed on its own would corrupt the
protocol stream a real client is parsing. Two ways to actually see it do something:

### 1. Wire it into an MCP client

Point your MCP-capable client (Claude Code, Claude Desktop, another agent host) at the command `decida mcp` (or
`uv run decida mcp` from a clone of this repo), with `DECIDA_URL` set if needed. The client launches it, sends
`initialize`/`tools/list`/`tools/call`, and reads the responses.

### 2. Browser UI: MCP Inspector

The official [MCP Inspector](https://github.com/modelcontextprotocol/inspector) launches any stdio MCP server as a
subprocess and gives you a web page to call its tools interactively, no client config needed:

```bash
npx @modelcontextprotocol/inspector decida mcp
```

This fetches the inspector package from npm on first run and opens a local browser tab listing decida's tools; fill
in a tool's arguments and hit "Execute Tool" to see the response.

### 3. By hand, over stdin

A single JSON-RPC line in, one line of JSON out:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | decida mcp
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | decida mcp
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"classify_text","arguments":{"text":"...","labels":{"a":"...","b":"..."}}}}' | decida mcp
```

## The tools

Every tool answers using **the server's default model** (whichever one is starred in `decida ps`) — there is
currently no per-call way to pick a different one; see "Model selection" below. Every tool's response includes
`"model"`, naming exactly which one answered, so the caller is never left guessing.

### `gate_tool_call`

Should an agent's proposed tool call run? Returns `allow` / `confirm` / `block`.

```json
{"tool_call": "rm -rf /tmp/build", "environment": "production", "user_request": "clean up the build directory", "agent_reasoning": "removing stale build artifacts"}
```
&rarr; `{"gate": "confirm", "probabilities": {...}, "is_dangerous": 0.7, "expected_severity": 2.1, "model": "decidabert"}`

`environment` (`local` / `staging` / `production`) and `agent_reasoning` are optional.

### `vet_dependency`

Check a PyPI package before installing it: a live registry lookup (name, age, release count), judged against an
age policy.

```json
{"package": "requests", "min_age_days": 14}
```
&rarr; `{"gate": "allow", "probabilities": {...}, "registry": {"name": "requests", "latest_version": "...", "age_days": 5000, ...}, "model": "decidabert"}`

`min_age_days` is optional (default 14). A package that does not exist on PyPI is reported, not raised as an error.

### `triage_failure`

Classify a failing test/CI log: code bug, missing dependency, test setup, environment, or flaky.

```json
{"log": "AssertionError: expected 200, got 500\nConnectionRefusedError: [Errno 111]", "command": "pytest tests/test_api.py", "job": "tests"}
```
&rarr; `{"category": "environment", "probabilities": {...}, "retry_worthwhile": 0.6, "needs_code_change": 0.2, "model": "decidabert"}`

`command` and `job` are optional.

### `classify_text`

Classify free text into labels you supply.

```json
{"text": "My payment failed twice this week and support hasn't replied.", "labels": {"billing": "charges, invoices, refunds", "technical": "bugs, outages, errors"}, "instructions": "Which category fits the text best?"}
```
&rarr; `{"label": "billing", "probabilities": {"billing": 0.83, "technical": 0.17}, "model": "decidabert"}`

`labels` is `label -> description`; the description is what the model matches your text against, so write real
descriptions, not just short names. `instructions` is optional.

### `decide`

The raw escape hatch: any state plus any typed questions (`choice` / `score` / `noul`), passed straight through to
`/v1/systemone`. Unlike the other tools, its response is the full `/v1/systemone` payload as-is (`model`, `answers`,
`usage`, `x_decida`, `latency_ms`), not a reshaped summary.

```json
{"state": "Help! My payouts have been failing for 3 days.", "questions": {"is_urgent": {"type": "noul", "instructions": "Does this convey urgency?"}}}
```
&rarr; `{"model": "decidabert", "answers": {"is_urgent": {"type": "noul", "noul": 0.82}}, "usage": {...}, "x_decida": {...}, "latency_ms": 47.3}`

## Model selection

Every tool call sends a hardcoded `model: "decida"` to `/v1/systemone`; `resolve()` in `serve/api.py` treats any
model name starting with `"decida"` (like `None`, `"default"` and `"latest"`) as a generic placeholder and routes
it to the server's default model. There is no argument on any tool today to name a specific loaded model instead.

**To change which model is the default** (and so which one every MCP tool call uses): `decida serve` registers
models in list order and its default is whichever one registers first (`runtime/store.py`). Move a model to the
front of `~/.decida/settings.json`'s list with:

```bash
decida setup --default <alias-or-number>   # e.g. decida setup --default qwen
```

`decida setup --list` marks the current default with `[default]`. If you serve several models and always want a
specific one, the simplest option is still to start `decida serve` with just that one.
