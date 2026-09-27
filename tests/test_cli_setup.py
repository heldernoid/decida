"""`decida setup` and how `decida serve` uses the settings, with the Hub mocked."""
import json

import pytest
from typer.testing import CliRunner

from decida import cli
from decida import settings as S
from decida.runtime.detect import Backend, Detection

runner = CliRunner()


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("DECIDA_HOME", str(tmp_path / "home"))
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    return tmp_path / "home"


@pytest.fixture
def hub(monkeypatch):
    """Every repo id 'exists' as an encoder, except ones with 'missing' or 'broken' in the name."""
    def fake(ref, revision=None):
        if "missing" in ref:
            raise FileNotFoundError("repository not found")
        if "broken" in ref:
            return Detection(Backend.UNSUPPORTED, "no config.json, rl_agent_config.json or head .pt found", ref)
        return Detection(Backend.ENCODER, "test", ref, quality_mode="specialist", license="apache-2.0")
    monkeypatch.setattr("decida.runtime.detect.detect", fake)


def settings():
    return json.loads(S.path().read_text())


def aliases():
    return [m["alias"] for m in settings()["models"]]


def test_list_shows_the_defaults_without_creating_a_file(home):
    r = runner.invoke(cli.app, ["setup", "--list"])
    assert r.exit_code == 0 and "helmo/DecidaBERT-large" in r.output and "helmo/laya:multilingual" in r.output
    assert "hosted; TYPESAFE_API_KEY is NOT set" in r.output
    assert not S.path().exists()


def test_path_prints_where_the_file_lives(home):
    r = runner.invoke(cli.app, ["setup", "--path"])
    assert r.output.strip() == str(home / "settings.json")


def test_add_and_remove_from_flags_saves_the_file(home, hub):
    r = runner.invoke(cli.app, ["setup", "--add", "someone/my-model", "--add", "tiny=someone/other", "--remove", "qwen"])
    assert r.exit_code == 0, r.output
    assert "encoder, specialist, apache-2.0" in r.output and "added my-model" in r.output and "removed qwen" in r.output
    assert aliases()[-2:] == ["my-model", "tiny"] and "qwen" not in aliases()


def test_a_model_the_hub_does_not_know_is_refused_unless_told_not_to_check(home, hub):
    r = runner.invoke(cli.app, ["setup", "--add", "someone/missing-model"])
    assert r.exit_code == 1 and "could not check" in r.output and not S.path().exists()
    r = runner.invoke(cli.app, ["setup", "--add", "someone/broken-model"])
    assert r.exit_code == 1 and "cannot be served" in r.output
    r = runner.invoke(cli.app, ["setup", "--add", "someone/missing-model", "--no-check"])
    assert r.exit_code == 0 and "missing-model" in aliases()


def test_adding_a_taken_alias_and_removing_an_unknown_one_fail_cleanly(home, hub):
    r = runner.invoke(cli.app, ["setup", "--add", "qwen=someone/x"])
    assert r.exit_code == 1 and "already a model called 'qwen'" in r.output
    r = runner.invoke(cli.app, ["setup", "--remove", "nope"])
    assert r.exit_code == 1 and "aliases are:" in r.output


def test_reset_restores_the_defaults(home, hub):
    runner.invoke(cli.app, ["setup", "--remove", "1", "--remove", "1"])
    assert len(aliases()) == 4
    r = runner.invoke(cli.app, ["setup", "--reset"])
    assert r.exit_code == 0 and aliases()[0] == "decidabert" and len(aliases()) == 6


def test_the_menu_adds_removes_and_saves(home, hub):
    script = "a\nsomeone/menu-model\nr\njev\np\n8123\nn\nq\n"
    r = runner.invoke(cli.app, ["setup"], input=script)
    assert r.exit_code == 0, r.output
    assert "added menu-model" in r.output and "removed jev" in r.output and "Saved" in r.output
    s = settings()
    assert "menu-model" in aliases() and "jev" not in aliases() and s["server"]["port"] == 8123 and s["server"]["lazy"] is False


def test_the_menu_can_add_an_unknown_model_anyway_when_asked(home, hub):
    script = "a\nsomeone/missing-one\ny\nq\n"
    r = runner.invoke(cli.app, ["setup"], input=script)
    assert r.exit_code == 0 and "missing-one" in aliases()
    script = "a\nsomeone/missing-two\nn\nq\n"
    runner.invoke(cli.app, ["setup"], input=script)
    assert "missing-two" not in aliases()


def test_the_menu_says_where_everything_lives(home, hub):
    r = runner.invoke(cli.app, ["setup"], input="q\n")
    assert str(home / "settings.json") in r.output and str(home / "datasets") in r.output and "Hugging Face" in r.output


def test_the_menu_ignores_nonsense_and_quitting_immediately_keeps_the_file_valid(home, hub):
    r = runner.invoke(cli.app, ["setup"], input="zzz\nq\n")
    assert r.exit_code == 0 and "choose a, r, d, p or q" in r.output
    assert S.load()[0].models[0].alias == "decidabert"


def test_a_damaged_settings_file_stops_setup_and_serve_with_a_message(home):
    home.mkdir(parents=True)
    S.path().write_text("{ broken")
    for args in (["setup", "--list"], ["serve"]):
        r = runner.invoke(cli.app, args)
        assert r.exit_code == 1 and "could not be read" in r.output
    assert S.path().read_text() == "{ broken"


@pytest.fixture
def served(monkeypatch):
    """Capture what `decida serve` would start, without starting a server."""
    seen = {}
    import uvicorn

    def run(app, host, port):
        import os
        seen.update(host=host, port=port, env={k: v for k, v in os.environ.items() if k.startswith("DECIDA_")})
    monkeypatch.setattr(uvicorn, "run", run)
    for k in list(__import__("os").environ):
        if k.startswith("DECIDA_") and k != "DECIDA_HOME":
            monkeypatch.delenv(k)
    return seen


def test_serve_without_models_uses_and_creates_the_settings(home, served):
    r = runner.invoke(cli.app, ["serve"])
    assert r.exit_code == 0, r.output
    assert "Created" in r.output and "jev (hosted) skipped: set TYPESAFE_API_KEY" in r.output
    env = served["env"]
    assert env["DECIDA_MODELS"].split(";")[0] == "decidabert=helmo/DecidaBERT-large" and len(env["DECIDA_MODELS"].split(";")) == 5
    assert env["DECIDA_PRELOAD"] == "0" and served["port"] == 8000 and env["DECIDA_REMOTE_KEY_ENV"] == "TYPESAFE_API_KEY"
    assert env["DECIDA_MAX_LEN"] == "2048" and env["DECIDA_HEAD_TOKENS"] == "1400" and env["DECIDA_OPTION_TOKENS"] == "160"
    assert S.path().exists()
    again = runner.invoke(cli.app, ["serve"])
    assert "Created" not in again.output


def test_serve_includes_the_hosted_model_when_its_key_is_set(home, served, monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "not-a-real-key")
    r = runner.invoke(cli.app, ["serve"])
    assert "skipped" not in r.output and served["env"]["DECIDA_MODELS"].split(";")[-1].startswith("jev=https://api.typesafe.ai")


def test_command_line_flags_beat_the_settings(home, served):
    runner.invoke(cli.app, ["serve", "--port", "9999", "--no-lazy", "--max-len", "512"])
    assert served["port"] == 9999 and served["env"]["DECIDA_PRELOAD"] == "1" and served["env"]["DECIDA_MAX_LEN"] == "512"


def test_an_explicit_model_list_ignores_the_settings_list_and_writes_no_file(home, served):
    r = runner.invoke(cli.app, ["serve", "-m", "x=someone/thing"])
    assert r.exit_code == 0 and served["env"]["DECIDA_MODELS"] == "x=someone/thing"
    assert served["env"]["DECIDA_PRELOAD"] == "1", "as before: an explicit list loads at startup unless --lazy"
    assert not S.path().exists()
    assert runner.invoke(cli.app, ["serve", "-m", "x=someone/thing", "--lazy"]).exit_code == 0 and served["env"]["DECIDA_PRELOAD"] == "0"


def test_serve_with_an_empty_list_says_what_to_do(home, served):
    S.save(S.Settings(models=[]))
    r = runner.invoke(cli.app, ["serve"])
    assert r.exit_code == 1 and "decida setup" in r.output


@pytest.fixture
def pulled(monkeypatch):
    """`local_dir` just records what it was asked to fetch, instead of touching the network."""
    calls: list[str] = []

    def fake(ref, revision=None):
        calls.append(ref)
        if "missing" in ref:
            raise FileNotFoundError("repository not found")
        return f"/cache/{ref}"
    monkeypatch.setattr("decida.runtime.refs.local_dir", fake)
    return calls


def test_pull_with_no_args_downloads_every_local_model_in_settings(home, pulled):
    S.save(S.default_settings())
    r = runner.invoke(cli.app, ["pull"])
    assert r.exit_code == 0
    assert pulled == [m.ref for m in S.default_settings().models if not m.hosted]
    assert "jev" not in r.output


def test_pull_never_loads_a_model_into_a_torch_engine(home, pulled, monkeypatch):
    """`pull` must go through refs.local_dir only; it must never touch Engine/store, which would use RAM or VRAM."""
    import decida.runtime.store as store_mod
    monkeypatch.setattr(store_mod, "ModelStore", None)  # any use would raise TypeError, proving pull never touches it
    r = runner.invoke(cli.app, ["pull", "someone/one-model"])
    assert r.exit_code == 0 and pulled == ["someone/one-model"]


def test_pull_with_explicit_refs_ignores_settings(home, pulled):
    r = runner.invoke(cli.app, ["pull", "someone/a", "alias=someone/b"])
    assert r.exit_code == 0 and pulled == ["someone/a", "someone/b"]


def test_pull_reports_a_failure_but_keeps_going(home, pulled):
    r = runner.invoke(cli.app, ["pull", "someone/missing-model", "someone/ok"])
    assert r.exit_code == 1
    assert pulled == ["someone/missing-model", "someone/ok"]
    assert "someone/missing-model" in r.output and "someone/ok" in r.output


def test_pull_with_no_local_models_says_so(home, pulled):
    S.save(S.Settings(models=[]))
    r = runner.invoke(cli.app, ["pull"])
    assert r.exit_code == 1
