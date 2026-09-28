"""Decida command line: serve System One (decision) models over REST and MCP."""
import os
from typing import Annotated

import typer

app = typer.Typer(help="Decida: a runtime for System One decision models (REST, MCP, testbench).", no_args_is_help=True)


def _version_callback(value: bool) -> None:
    if value:
        from importlib.metadata import version
        typer.echo(version("decida"))
        raise typer.Exit()


@app.callback()
def main(version: Annotated[bool, typer.Option("--version", callback=_version_callback, is_eager=True, help="Show the installed version and exit")] = False) -> None:
    pass


@app.command("help")
def help_cmd(ctx: typer.Context) -> None:
    """Show this help message."""
    typer.echo((ctx.parent or ctx).get_help())


def _load_settings(create: bool):
    """The settings, or a clear message and exit code 1 if the file is damaged."""
    from decida import settings as st
    try:
        return st.load(create=create)
    except st.SettingsError as exc:
        typer.echo(f"error: {exc}", err=True)
        raise typer.Exit(1) from exc


@app.command("serve")
def serve_cmd(models: Annotated[list[str] | None, typer.Option("--model", "-m", help="Model ref (username/model-id, a folder, or a hosted URL), optionally alias=ref. Repeat for several. Leave out to serve the models in ~/.decida/settings.json")] = None,
              device: str = typer.Option(None, help="Device to run on (cuda/mps/cpu/auto); default from settings"),
              host: str = typer.Option(None, help="Host to bind to; default from settings"),
              port: int = typer.Option(None, help="Port to bind to; default from settings"),
              backend: str = typer.Option("", help="Force a backend (encoder | lm | clm | gliner) instead of auto-detecting"),
              dtype: str = typer.Option("auto", help="lm/clm backends: auto | float32 | bfloat16 | float16"),
              lazy: bool = typer.Option(None, "--lazy/--no-lazy", help="Load each model on its first request instead of at startup; default from settings when serving the settings list, otherwise off"),
              head_tokens: int = typer.Option(None, help="encoder backend: token budget shared by the instructions and ALL options (0 keeps the trained 192); default from settings"),
              option_tokens: int = typer.Option(None, help="encoder backend: max tokens per option (0 keeps the trained 48); default from settings"),
              remote_budget_usd: float = typer.Option(None, help="hosted (remote) models only: stop forwarding requests once this much is spent (estimated); default from settings"),
              remote_price_per_m: float = typer.Option(None, help="hosted models only: USD per million input tokens used for the estimate; default from settings"),
              remote_key_env: str = typer.Option(None, help="hosted models only: name of the environment variable holding the API key (default TYPESAFE_API_KEY, from settings)"),
              max_len: int = typer.Option(None, help="encoder backend: max total tokens including the state (0 keeps the model's own default); default from settings")):
    """Start the Decida HTTP API server."""
    import os

    import uvicorn

    from decida import settings as st
    if backend and backend not in ("encoder", "lm", "clm", "gliner", "remote"):
        raise typer.BadParameter("backend must be encoder, lm, clm, gliner or remote")
    models = models or []
    cfg, created = _load_settings(create=not models)   # an explicit -m never writes a settings file
    if models:
        specs, notes = list(models), []
        use_lazy = bool(lazy)
    else:
        specs, notes = st.serve_specs(cfg)
        use_lazy = cfg.server.lazy if lazy is None else lazy
        if created:
            typer.echo(f"Created {st.path()} with the default models. Run `decida setup` to add or remove models.")
        if not specs:
            typer.echo("error: no models to serve. Run `decida setup` to add some.", err=True)
            raise typer.Exit(1)
    for n in notes:
        typer.echo(f"note: {n}")
    srv, hosted = cfg.server, cfg.hosted
    def pick(given, fallback):
        return fallback if given is None else given
    device, host, port = pick(device, srv.device), pick(host, srv.host), pick(port, srv.port)
    os.environ.update(DECIDA_MODELS=";".join(specs), DECIDA_DEVICE=device, DECIDA_BACKEND=backend, DECIDA_LM_DTYPE=dtype,
                      DECIDA_PRELOAD="0" if use_lazy else "1")
    os.environ.update(DECIDA_REMOTE_BUDGET_USD=str(pick(remote_budget_usd, hosted.budget_usd)),
                      DECIDA_REMOTE_PRICE_PER_M=str(pick(remote_price_per_m, hosted.price_per_m_input)),
                      DECIDA_REMOTE_KEY_ENV=pick(remote_key_env, hosted.key_env))
    for name, val in (("DECIDA_HEAD_TOKENS", pick(head_tokens, srv.head_tokens)), ("DECIDA_OPTION_TOKENS", pick(option_tokens, srv.option_tokens)),
                      ("DECIDA_MAX_LEN", pick(max_len, srv.max_len))):
        if val:
            os.environ[name] = str(val)
    st.write_running(host, port)
    typer.echo(f"Starting Decida on {host}:{port} with {', '.join(x.split('=')[0] if '=' in x and not x.startswith('http') else x for x in specs)}")
    uvicorn.run("decida.serve.api:app", host=host, port=port)


def _spec_parts(text: str) -> tuple[str | None, str]:
    """`alias=ref` -> (alias, ref); a bare ref (or a URL, which may contain '=') -> (None, ref)."""
    if text.startswith(("http://", "https://")) or "=" not in text:
        return None, text.strip()
    a, r = text.split("=", 1)
    return a.strip().lower(), r.strip()


def _check_model(ref: str) -> tuple[bool, str]:
    """Ask the Hub (or the disk) what this reference is: (usable, one line about it)."""
    from decida.runtime.detect import Backend, detect
    try:
        d = detect(ref)
    except Exception as exc:  # noqa: BLE001  any failure (offline, not found, private) is reported the same way
        return False, f"could not check {ref}: {type(exc).__name__}: {str(exc).splitlines()[0][:100] if str(exc) else ''}"
    if d.backend == Backend.UNSUPPORTED:
        return False, f"{ref} cannot be served: {d.reason}"
    return True, f"{d.backend}, {d.quality_mode}{', ' + d.license if d.license else ''}"


def _print_models(cfg) -> None:
    import os
    for i, m in enumerate(cfg.models, 1):
        tag = "  [default]" if i == 1 else ""  # decida serve registers models in list order; the first one registered is the default (runtime/store.py)
        if m.hosted:
            tag += f"  [hosted; {cfg.hosted.key_env} {'is set' if os.environ.get(cfg.hosted.key_env) else 'is NOT set'}]"
        typer.echo(f"  {i}. {m.alias:<22} {m.ref}{tag}")


def _add(cfg, text: str, check: bool, ask: bool) -> bool:
    from decida import settings as st
    alias, ref = _spec_parts(text)
    if check:
        ok, info = _check_model(ref)
        typer.echo(f"  {info}")
        if not ok and not (ask and typer.confirm("  Add it anyway?", default=False)):
            return False
    try:
        m = st.add_model(cfg, ref, alias)
    except (st.SettingsError, ValueError) as exc:
        typer.echo(f"  not added: {exc}")
        return False
    typer.echo(f"  added {m.alias} = {m.ref}")
    return True


@app.command("setup")
def setup_cmd(add: Annotated[list[str] | None, typer.Option("--add", help="Add a model: username/model-id, username/model-id:folder, a local folder, or alias=ref. Repeat for several")] = None,
              remove: Annotated[list[str] | None, typer.Option("--remove", help="Remove a model by alias or number. Repeat for several")] = None,
              reset: bool = typer.Option(False, "--reset", help="Restore the default list of models"),
              default: str = typer.Option(None, "--default", help="Move a model (alias or number) to the front of the list: it becomes decida serve's default"),
              list_: bool = typer.Option(False, "--list", help="Show the models in the settings and exit"),
              show_path: bool = typer.Option(False, "--path", help="Print the settings file location and exit"),
              no_check: bool = typer.Option(False, "--no-check", help="Add models without asking the Hub about them first (offline)")):
    """Choose which models Decida serves: add or remove them, or restore the defaults. Saved in ~/.decida/settings.json."""
    from decida import settings as st
    if show_path:
        typer.echo(str(st.path()))
        return
    cfg, created = _load_settings(create=False)
    if created is False and not st.path().exists():
        typer.echo(f"No settings yet at {st.path()}; starting from the default models.")
    add, remove = add or [], remove or []
    scripted = bool(add or remove or reset or default or list_)
    if list_:
        _print_models(cfg)
        return
    changed = False
    if reset:
        cfg.models = st.default_models()
        typer.echo("Restored the default models.")
        changed = True
    for r in remove:
        try:
            typer.echo(f"removed {st.remove_model(cfg, r).alias}")
            changed = True
        except st.SettingsError as exc:
            typer.echo(f"error: {exc}", err=True)
            raise typer.Exit(1) from exc
    for a in add:
        if not _add(cfg, a, check=not no_check, ask=False):
            raise typer.Exit(1)
        changed = True
    if default:
        try:
            typer.echo(f"default is now {st.set_default(cfg, default).alias}")
            changed = True
        except st.SettingsError as exc:
            typer.echo(f"error: {exc}", err=True)
            raise typer.Exit(1) from exc
    if scripted:
        if changed:
            typer.echo(f"Saved {st.save(cfg)}")
        return

    from decida import datasets
    typer.echo(f"Decida setup\n  settings   {st.path()}\n  datasets   {datasets.data_dir()}   (downloaded when a bench needs them)\n"
               f"  models     downloaded by Hugging Face into its own cache ({os.environ.get('HF_HOME') or '~/.cache/huggingface'})\n")
    while True:
        typer.echo("Models Decida serves:")
        _print_models(cfg)
        typer.echo("\n  [a] add a model   [r] remove a model   [m] make one the default   [d] restore the default list   [p] port and loading   [q] save and quit")
        choice = typer.prompt("> ", default="q", show_default=False).strip().lower()
        if choice in ("q", "quit", ""):
            break
        if choice == "a":
            text = typer.prompt("Model id (username/model-id, username/model-id:folder, a local folder, or alias=ref)").strip()
            if text and _add(cfg, text, check=not no_check, ask=True):
                changed = True
        elif choice == "r":
            key = typer.prompt("Which one? (alias or number)").strip()
            try:
                typer.echo(f"  removed {st.remove_model(cfg, key).alias}")
                changed = True
            except st.SettingsError as exc:
                typer.echo(f"  {exc}")
        elif choice == "m":
            key = typer.prompt("Which one? (alias or number)").strip()
            try:
                typer.echo(f"  default is now {st.set_default(cfg, key).alias}")
                changed = True
            except st.SettingsError as exc:
                typer.echo(f"  {exc}")
        elif choice == "d":
            if typer.confirm("Replace the list with the defaults?", default=False):
                cfg.models = st.default_models()
                changed = True
        elif choice == "p":
            cfg.server.port = typer.prompt("Port", default=cfg.server.port, type=int)
            cfg.server.lazy = typer.confirm("Load each model on its first request instead of at startup?", default=cfg.server.lazy)
            changed = True
        else:
            typer.echo("  choose a, r, m, d, p or q")
        typer.echo("")
    st.save(cfg)
    typer.echo(f"Saved {st.path()}. Start the server with: decida serve")


def _human_size(n: int) -> str:
    size = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{int(size)} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} GB"  # unreachable, keeps type checkers happy


def _dir_size(path) -> int:
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())


def _model_row(ref: str) -> tuple[str, str, str]:
    """(id, size, modified) for `ref`, without downloading it or calling the Hub. `id`/`size` are "-" when there is
    nothing on disk to measure; `modified` then carries the reason instead (hosted / local / not downloaded / ...)."""
    from decida.runtime.refs import is_url, split_ref
    if is_url(ref):
        return "-", "-", "hosted"
    from pathlib import Path
    repo, folder = split_ref(ref)
    local = Path(repo).expanduser()
    if local.exists():
        return "-", _human_size(_dir_size(local / folder if folder else local)), "local"
    try:
        from huggingface_hub import scan_cache_dir
        from huggingface_hub.errors import CacheNotFound
    except ImportError:
        return "-", "-", "unknown (huggingface_hub not installed)"
    try:
        info = scan_cache_dir()
    except CacheNotFound:
        return "-", "-", "not downloaded"
    for r in info.repos:
        if r.repo_type != "model" or r.repo_id != repo:
            continue
        rev = max(r.revisions, key=lambda v: v.last_modified)  # the most recently touched snapshot
        if not folder:
            return rev.commit_hash[:12], _human_size(r.size_on_disk), r.last_modified_str
        sub = Path(rev.snapshot_path, folder)
        if not sub.is_dir() or not any(sub.iterdir()):
            return "-", "-", "partial (repo cached, not this folder)"
        return rev.commit_hash[:12], _human_size(_dir_size(sub)), rev.last_modified_str
    return "-", "-", "not downloaded"


def _print_table(headers: tuple[str, ...], rows: list[tuple[str, ...]]) -> None:
    """An ollama-`list`-style aligned table: every column but the last is left-justified to its widest cell; the
    last column (always a ref/URL here, which can be long) is never padded."""
    if not rows:
        widths = [len(h) for h in headers[:-1]]
    else:
        widths = [max(len(h), *(len(row[i]) for row in rows)) for i, h in enumerate(headers[:-1])]
    line = lambda cells: "  ".join(c.ljust(w) for c, w in zip(cells, widths)) + ("  " + cells[-1] if len(cells) > len(widths) else "")
    typer.echo(line(headers))
    for row in rows:
        typer.echo(line(row))


@app.command("list")
def list_cmd():
    """List the models in settings.json and whether each has been downloaded (like `decida pull`, this never loads a model)."""
    cfg, _ = _load_settings(create=True)
    if not cfg.models:
        typer.echo("no models in settings.json; run `decida setup` to add some")
        return
    rows = [(m.alias, *_model_row(m.ref), m.ref) for m in cfg.models]
    _print_table(("NAME", "ID", "SIZE", "MODIFIED", "REF"), rows)


@app.command("ps")
def ps_cmd(url: str = typer.Option("http://127.0.0.1:8000", help="Running Decida server")):
    """List the models loaded by a running `decida serve`."""
    import json
    import urllib.error
    import urllib.request
    try:
        with urllib.request.urlopen(f"{url}/v1/models") as r:
            data = json.load(r)
    except (urllib.error.URLError, ConnectionError, TimeoutError) as exc:
        typer.echo(f"error: could not reach {url} ({exc}). Is `decida serve` running?", err=True)
        raise typer.Exit(1) from exc
    except json.JSONDecodeError as exc:
        typer.echo(f"error: {url} did not return valid JSON; is it a Decida server?", err=True)
        raise typer.Exit(1) from exc
    rows = [("*" if m["name"] == data["default"] else "", m["name"], m["backend"], m["status"], m["device"], m["quality_mode"], m["ref"]) for m in data["models"]]
    _print_table(("", "NAME", "BACKEND", "STATUS", "DEVICE", "MODE", "REF"), rows)


@app.command("unload")
def unload_cmd(alias: str = typer.Argument(..., help="Model alias to unload"),
               url: str = typer.Option("http://127.0.0.1:8000", help="Running Decida server")):
    """Unload a model from a running `decida serve`, freeing its RAM/VRAM and removing it from that server's list
    (`decida ps` stops showing it; it is not enough afterwards to just name it in a request). It stays configured
    in settings.json and downloaded on disk; to serve it again on the same running server, POST its ref back to
    /v1/models, or restart `decida serve`."""
    import json
    import urllib.error
    import urllib.request
    req = urllib.request.Request(f"{url}/v1/models/{alias}", method="DELETE")
    try:
        with urllib.request.urlopen(req) as r:
            data = json.load(r)
    except urllib.error.HTTPError as exc:
        try:
            message = json.load(exc).get("error", {}).get("message", str(exc))
        except json.JSONDecodeError:
            message = str(exc)
        typer.echo(f"error: {message}", err=True)
        raise typer.Exit(1) from exc
    except (urllib.error.URLError, ConnectionError, TimeoutError) as exc:
        typer.echo(f"error: could not reach {url} ({exc}). Is `decida serve` running?", err=True)
        raise typer.Exit(1) from exc
    except json.JSONDecodeError as exc:
        typer.echo(f"error: {url} did not return valid JSON; is it a Decida server?", err=True)
        raise typer.Exit(1) from exc
    typer.echo(f"unloaded {data['removed']}")


@app.command("data")
def data_cmd(action: str = typer.Argument(..., help="status | download"),
             dataset: str = typer.Argument("wikispeedia", help="Dataset id")):
    """Show whether a bench dataset is on disk, or download it (verified against pinned SHA-256)."""
    import json

    from decida import datasets
    try:
        if action == "download":
            def progress(name: str, done: int, total: int) -> None:
                typer.echo(f"\r{name}: {100 * done // total}% ({done // 1_000_000}/{total // 1_000_000} MB)", nl=False, err=True)
            datasets.ensure(dataset, progress)
            typer.echo("", err=True)
        elif action != "status":
            raise typer.BadParameter("action must be status or download")
        st = datasets.status(dataset)
    except datasets.DatasetError as exc:
        typer.echo(json.dumps({"dataset": dataset, "ok": False, "error": str(exc)}))
        raise typer.Exit(1) from exc
    typer.echo(json.dumps({"dataset": st.id, "ok": True, "present": st.present, "path": st.path, "parts": [p.model_dump() for p in st.parts]}))


@app.command("pull")
def pull_cmd(refs: Annotated[list[str] | None, typer.Argument(help="Model refs to download (username/model-id, username/model-id:folder, or alias=ref). Leave out to pull every model in settings.json")] = None):
    """Download models to the Hugging Face cache without loading them into RAM or VRAM.

    This never touches ~/.decida/settings.json, so pulling a model does not by itself make `decida serve` serve
    it; the command prints the exact next step to do that.
    """
    from decida.runtime.refs import alias_for, is_url, local_dir

    from_settings = not refs
    if refs:
        pairs = [_spec_parts(r) for r in refs]
    else:
        cfg, _ = _load_settings(create=True)
        pairs = [(m.alias, m.ref) for m in cfg.models if not m.hosted]
        if not pairs:
            typer.echo("no local models in settings.json; run `decida setup` to add some")
            raise typer.Exit(1)
    failed = 0
    pulled: list[tuple[str, str]] = []   # (alias, ref) actually fetched, for the "how to serve this" hint below
    for alias, ref in pairs:
        label = f"{alias}={ref}" if alias else ref
        if is_url(ref):
            typer.echo(f"{label}: skipped (hosted model, nothing to download)")
            continue
        try:
            path = local_dir(ref)
        except Exception as exc:  # noqa: BLE001 - one bad ref should not stop the rest
            typer.echo(f"error: {label}: {exc}", err=True)
            failed += 1
            continue
        typer.echo(f"{label}: {path}")
        pulled.append((alias or alias_for(ref), ref))
    if pulled:
        if from_settings:
            typer.echo("\nThese are already in settings.json; run `decida serve` to serve them.")
        else:
            flags = " ".join(f'--model {a}={r}' for a, r in pulled)
            typer.echo(f"\nThese are not in settings.json yet. Serve them directly:\n  decida serve {flags}"
                       f"\nor add them for every future `decida serve`:\n  decida setup " + " ".join(f'--add {a}={r}' for a, r in pulled))
    if failed:
        raise typer.Exit(1)


@app.command("detect")
def detect_cmd(ref: str = typer.Argument(..., help="HF id or local path")):
    """Show which backend would serve a model (reads file names and small configs only)."""
    import json
    from dataclasses import asdict

    from decida.runtime.detect import detect
    typer.echo(json.dumps(asdict(detect(ref)), indent=2))


@app.command("check")
def check_cmd(ref: str = typer.Argument(..., help="HF id or local path of the model to smoke-test"),
              device: str = typer.Option("auto", help="cuda/mps/cpu/auto"),
              backend: str = typer.Option("", help="Force a backend instead of auto-detecting"),
              verbose: bool = typer.Option(False, "--verbose", "-v", help="Print every check")):
    """Load a model and run the 14 smoke checks. Exit code 1 if wiring is broken."""
    import asyncio
    import json

    from decida.checks import run_checks
    from decida.runtime.store import ModelStore
    from decida.serve.engine import SystemOneRequest

    async def go() -> dict:
        store = ModelStore(device)
        entry = store.add(ref, backend=backend or None)
        await store.ensure_loaded(entry.name)
        return await run_checks(lambda req: entry.engine.predict_async(SystemOneRequest({**req, "model": entry.name})))

    res = asyncio.run(go())
    if verbose:
        for r in res["results"]:
            typer.echo(f"{'ok ' if r['correct'] else 'MISS' if r['wiring'] else 'WIRE'} {r['id']:<20} expected={r['expected']!s:<9} got={r['got']}")
    typer.echo(json.dumps({"model": ref, "wiring_ok": f"{res['wiring_ok']}/{res['total']}", "correct": f"{res['correct']}/{res['total']}", "passed": res["passed"]}))
    raise typer.Exit(0 if res["passed"] else 1)


@app.command("predict")
def predict_cmd(model_dir: str = typer.Option(..., "--model", help="Model folder or Hub id (username/model-id)"),
                state_file: str = typer.Option(..., "--state", help="Path to JSON file containing state"),
                questions_file: str = typer.Option(..., "--questions", help="Path to JSON file containing questions map")):
    """Run a single prediction locally."""
    import json
    from pathlib import Path

    from decida.runtime.refs import local_dir
    from decida.serve.engine import Engine, SystemOneRequest

    state = json.loads(Path(state_file).read_text(encoding="utf-8"))
    questions = json.loads(Path(questions_file).read_text(encoding="utf-8"))
    engine = Engine.load(local_dir(model_dir))     # a folder, or a Hub id such as helmo/DecidaBERT-large
    resp = engine.predict(SystemOneRequest({"model": "local", "state": state, "questions": questions}))
    typer.echo(json.dumps(resp, indent=2))

@app.command("mcp")
def mcp_cmd():
    """Run the MCP stdio server (env DECIDA_URL points at a running `decida serve`)."""
    from decida.mcp_server import main
    main()

if __name__ == "__main__":
    app()
