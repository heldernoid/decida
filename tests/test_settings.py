"""The settings file: defaults, safe reading and writing, adding and removing models, and what `serve` starts."""
import json

import pytest

from decida import settings as S


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("DECIDA_HOME", str(tmp_path / "decida-home"))
    return tmp_path / "decida-home"


def test_the_defaults_are_the_models_we_ship_plus_the_hosted_reference():
    s = S.default_settings()
    assert [m.alias for m in s.models] == ["decidabert", "laya-typed-decisions", "laya", "laya-multilingual", "qwen", "jev"]
    refs = {m.alias: m.ref for m in s.models}
    assert refs["decidabert"] == "helmo/DecidaBERT-large" and refs["laya-typed-decisions"] == "helmo/laya:typed-decisions"
    assert refs["laya"] == "helmo/laya" and refs["laya-multilingual"] == "helmo/laya:multilingual" and refs["qwen"] == "helmo/Qwen3-0.6B"
    assert [m.alias for m in s.models if m.hosted] == ["jev"]
    assert s.hosted.key_env == "TYPESAFE_API_KEY" and s.server.port == 8000 and s.server.lazy is True


def test_the_first_load_creates_the_file_and_later_loads_read_it(home):
    s, created = S.load()
    assert created and S.path() == home / "settings.json" and S.path().exists()
    s2, created2 = S.load()
    assert not created2 and s2 == s
    assert json.loads(S.path().read_text())["models"][0]["alias"] == "decidabert"


def test_load_without_create_leaves_the_disk_alone(home):
    s, created = S.load(create=False)
    assert s.models and not S.path().exists() and created is False


def test_saving_is_atomic_and_round_trips(home):
    s = S.default_settings()
    s.server.port = 9001
    S.save(s)
    assert not list(home.glob("*.tmp")) and S.load()[0].server.port == 9001


def test_a_damaged_file_is_reported_and_never_overwritten(home):
    home.mkdir(parents=True)
    S.path().write_text('{"models": [ this is not json')
    with pytest.raises(S.SettingsError, match="could not be read"):
        S.load()
    assert S.path().read_text().startswith('{"models": [ this is')
    S.path().write_text(json.dumps({"models": [{"alias": "Bad Alias!", "ref": "x/y"}]}))
    with pytest.raises(S.SettingsError, match="alias"):
        S.load()
    S.path().write_text(json.dumps({"models": [{"alias": "a", "ref": "x/y"}, {"alias": "a", "ref": "x/z"}]}))
    with pytest.raises(S.SettingsError, match="used twice"):
        S.load()


def test_add_a_model_with_a_short_default_alias():
    s = S.default_settings()
    m = S.add_model(s, " someone/Tiny-Model ")
    assert (m.alias, m.ref) == ("tiny-model", "someone/Tiny-Model") and s.models[-1] is m
    f = S.add_model(s, "someone/Big:small-folder")
    assert f.alias == "big-small-folder"
    assert S.add_model(s, "other/thing", alias="Mine").alias == "mine"


def test_adding_refuses_a_taken_alias_a_repeated_reference_and_a_bad_alias():
    s = S.default_settings()
    with pytest.raises(S.SettingsError, match="already a model called 'qwen'"):
        S.add_model(s, "someone/other", alias="qwen")
    with pytest.raises(S.SettingsError, match="already in the list as 'decidabert'"):
        S.add_model(s, "helmo/DecidaBERT-large", alias="second")
    with pytest.raises(ValueError, match="alias"):
        S.add_model(s, "someone/x", alias="No Spaces")
    with pytest.raises(ValueError, match="reference"):
        S.add_model(s, "   ")
    assert len(s.models) == 6, "nothing was added by the failed attempts"


def test_remove_by_alias_or_by_number_and_say_what_exists_otherwise():
    s = S.default_settings()
    assert S.remove_model(s, "qwen").alias == "qwen"
    assert S.remove_model(s, "1").alias == "decidabert"
    assert [m.alias for m in s.models] == ["laya-typed-decisions", "laya", "laya-multilingual", "jev"]
    with pytest.raises(S.SettingsError, match="aliases are: laya-typed-decisions"):
        S.remove_model(s, "nope")
    with pytest.raises(S.SettingsError):
        S.remove_model(s, "99")


def test_serve_starts_every_model_and_leaves_out_the_hosted_one_without_its_key():
    s = S.default_settings()
    specs, notes = S.serve_specs(s, {})
    assert specs[0] == "decidabert=helmo/DecidaBERT-large" and len(specs) == 5 and not any(x.startswith("jev=") for x in specs)
    assert notes == ["jev (hosted) skipped: set TYPESAFE_API_KEY to use it"]
    specs, notes = S.serve_specs(s, {"TYPESAFE_API_KEY": "x"})
    assert specs[-1].startswith("jev=https://") and notes == [] and len(specs) == 6
    s.hosted.key_env = "MY_KEY"
    assert S.serve_specs(s, {"TYPESAFE_API_KEY": "x"})[1], "the configured variable name is the one that is checked"


def test_the_file_never_holds_a_secret(home):
    S.load()
    text = S.path().read_text()
    assert "TYPESAFE_API_KEY" in text and "sk-" not in text
