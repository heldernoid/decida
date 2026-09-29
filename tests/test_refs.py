"""Model references: `org/name:folder`, aliases, what gets downloaded, and detection inside a folder of a repo (Hub mocked)."""
import json
from pathlib import Path

import pytest

from decida.runtime import refs
from decida.runtime.detect import Backend, detect
from decida.runtime.store import ModelStore, alias_for
from decida.serve.engine import tokenizer_dir

LAYA_FILES = ["README.md", "model.safetensors", "rl_agent_config.json", "encoder/config.json", "tokenizer/tokenizer.json",
              "multilingual/model.safetensors", "multilingual/rl_agent_config.json", "multilingual/tokenizer/tokenizer.json",
              "typed-decisions/model.safetensors", "typed-decisions/rl_agent_config.json", "assets/logo.png"]


def test_split_ref():
    assert refs.split_ref("helmo/laya") == ("helmo/laya", None)
    assert refs.split_ref("helmo/laya:typed-decisions") == ("helmo/laya", "typed-decisions")
    assert refs.split_ref("org/name:a/b") == ("org/name", "a/b")
    assert refs.split_ref("Qwen/Qwen3-0.6B") == ("Qwen/Qwen3-0.6B", None)
    url = "https://api.example.com/v1/systemone?model=x"
    assert refs.split_ref(url) == (url, None)


def test_a_local_folder_is_never_split(tmp_path):
    odd = tmp_path / "a" / "b:c"
    odd.mkdir(parents=True)
    assert refs.split_ref(str(odd)) == (str(odd), None)


def test_alias_names_the_checkpoint():
    assert alias_for("helmo/laya") == "laya"
    assert alias_for("helmo/laya:typed-decisions") == "laya-typed-decisions"
    assert alias_for("helmo/laya:multilingual") == "laya-multilingual"
    assert alias_for("Qwen/Qwen3-0.6B") == "qwen3-0.6b"
    assert alias_for("https://api.typesafe.ai/v1/systemone?model=jev-latest") == "jev-latest"
    assert alias_for("/models/decidabert/") == "decidabert"


def test_local_dir_for_folders_on_disk(tmp_path):
    (tmp_path / "laya" / "typed-decisions").mkdir(parents=True)
    assert refs.local_dir(str(tmp_path / "laya")) == tmp_path / "laya"
    assert refs.local_dir(f"{tmp_path / 'laya'}:typed-decisions") == tmp_path / "laya" / "typed-decisions"


def test_local_dir_and_detect_use_an_already_cached_snapshot_with_no_network_call(tmp_path, monkeypatch):
    """A model pulled before is found straight from the Hugging Face cache: no list_repo_files, no snapshot_download,
    no network at all. This is what lets `decida serve` work with no internet on an already-downloaded model."""
    import huggingface_hub as hh

    snap = tmp_path / "cached-snapshot"
    (snap / "typed-decisions").mkdir(parents=True)
    (snap / "rl_agent_config.json").write_text("{}")
    (snap / "typed-decisions" / "rl_agent_config.json").write_text("{}")
    monkeypatch.setattr(refs, "cached_snapshot", lambda repo, revision=None: snap if repo == "helmo/laya" else None)

    def boom(*a, **k):
        raise AssertionError("should not touch the network when the snapshot is already cached")
    monkeypatch.setattr(hh, "list_repo_files", boom)
    monkeypatch.setattr(hh, "snapshot_download", boom)
    monkeypatch.setattr(hh, "hf_hub_download", boom)

    assert refs.local_dir("helmo/laya") == snap
    assert refs.local_dir("helmo/laya:typed-decisions") == snap / "typed-decisions"
    assert detect("helmo/laya").backend == Backend.ENCODER
    assert detect("helmo/laya:typed-decisions").backend == Backend.ENCODER


def test_cached_snapshot_against_the_real_hf_cache_mechanism():
    """Exercises cached_snapshot() for real (no mocking of huggingface_hub itself): a repo nobody has ever pulled
    is never cached, whatever this machine's actual cache holds."""
    assert refs.cached_snapshot("nobody/this-repo-does-not-exist-anywhere") is None


@pytest.fixture
def hub(monkeypatch, tmp_path):
    """A fake Hub: one repo with three checkpoints; records what would be downloaded."""
    import huggingface_hub as hh
    calls = {"snapshot": [], "download": []}
    root = tmp_path / "snap"

    def snapshot_download(repo, revision=None, allow_patterns=None, ignore_patterns=None):
        calls["snapshot"].append({"repo": repo, "allow": allow_patterns, "ignore": ignore_patterns})
        (root / "typed-decisions").mkdir(parents=True, exist_ok=True)
        return str(root)

    def hf_hub_download(repo, name, revision=None):
        calls["download"].append(name)
        f = tmp_path / "dl" / name
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps({"architectures": ["ModernBertModel"]}) if name.endswith("config.json") else "# x")
        return str(f)

    monkeypatch.setattr(hh, "list_repo_files", lambda repo, revision=None: list(LAYA_FILES))
    monkeypatch.setattr(hh, "snapshot_download", snapshot_download)
    monkeypatch.setattr(hh, "hf_hub_download", hf_hub_download)
    monkeypatch.setattr(hh, "model_info", lambda repo: type("I", (), {"card_data": type("C", (), {"license": "apache-2.0"})()})())
    monkeypatch.setattr(refs, "cached_snapshot", lambda repo, revision=None: None)  # exercise the "not yet pulled" path, not this dev machine's real cache
    calls["root"] = root
    return calls


def test_a_folder_download_fetches_only_that_folder(hub):
    path = refs.local_dir("helmo/laya:typed-decisions")
    assert path == hub["root"] / "typed-decisions"
    assert hub["snapshot"][0]["allow"] == ["typed-decisions/*", "typed-decisions/**"] and hub["snapshot"][0]["ignore"] is None
    with pytest.raises(FileNotFoundError):
        refs.local_dir("helmo/laya:nope")


def test_the_root_download_skips_the_other_checkpoints_but_keeps_its_own_tokenizer_and_encoder(hub):
    refs.local_dir("helmo/laya")
    ignore = hub["snapshot"][0]["ignore"]
    assert ignore == ["multilingual/*", "multilingual/**", "typed-decisions/*", "typed-decisions/**"]
    assert not any(p.startswith(("tokenizer", "encoder", "assets")) for p in ignore)


def test_detect_reads_one_folder_of_a_repo(hub):
    assert detect("helmo/laya").backend == Backend.ENCODER
    d = detect("helmo/laya:typed-decisions")
    assert d.backend == Backend.ENCODER and d.ref == "helmo/laya:typed-decisions" and d.license == "apache-2.0"
    missing = detect("helmo/laya:nope")
    assert missing.backend == Backend.UNSUPPORTED and "no folder 'nope'" in missing.reason


def test_detect_reads_a_folder_on_disk(tmp_path):
    (tmp_path / "laya" / "multilingual").mkdir(parents=True)
    (tmp_path / "laya" / "multilingual" / "rl_agent_config.json").write_text("{}")
    assert detect(f"{tmp_path / 'laya'}:multilingual").backend == Backend.ENCODER
    assert detect(str(tmp_path / "laya")).backend == Backend.UNSUPPORTED     # the root itself holds no checkpoint


def test_the_store_names_and_lists_several_checkpoints_of_one_repo(hub):
    store = ModelStore("cpu")
    a = store.add("helmo/laya"); b = store.add("helmo/laya:multilingual"); c = store.add("helmo/laya:typed-decisions")
    assert [a.name, b.name, c.name] == ["laya", "laya-multilingual", "laya-typed-decisions"]
    assert all(e.detection.backend == Backend.ENCODER for e in (a, b, c))


def test_the_tokenizer_folder_rule(tmp_path):
    (tmp_path / "ours").mkdir()
    (tmp_path / "laya" / "tokenizer").mkdir(parents=True)
    assert tokenizer_dir(str(tmp_path / "ours")) == str(tmp_path / "ours")
    assert tokenizer_dir(str(tmp_path / "laya")) == str(tmp_path / "laya" / "tokenizer")
    assert Path(tokenizer_dir(str(tmp_path / "laya"))).name == "tokenizer"
