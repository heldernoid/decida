import json

import pytest

from decida.runtime.detect import Backend, _front_matter, detect
from decida.runtime.device import detect_device
from decida.runtime.store import ModelError, ModelStore, alias_for
from decida.serve.api import parse_model_specs


def test_device_explicit_passthrough():
    assert detect_device("cpu") == "cpu"
    assert detect_device("auto") in ("cuda", "mps", "cpu")


def test_detect_encoder(tmp_path):
    (tmp_path / "rl_agent_config.json").write_text("{}")
    d = detect(str(tmp_path))
    assert d.backend == Backend.ENCODER and d.calibrated and d.quality_mode == "specialist"


def test_detect_gliner(tmp_path):
    (tmp_path / "encoder_config").mkdir()
    (tmp_path / "encoder_config" / "config.json").write_text("{}")
    (tmp_path / "config.json").write_text(json.dumps({"model_type": "extractor", "architecture": "span"}))
    d = detect(str(tmp_path))
    assert d.backend == Backend.GLINER and not d.calibrated and d.quality_mode == "zero-shot"


def test_detect_lm(tmp_path):
    (tmp_path / "config.json").write_text(json.dumps({"architectures": ["Qwen3ForCausalLM"]}))
    assert detect(str(tmp_path)).backend == Backend.LM


def test_detect_clm_reads_base_from_readme(tmp_path):
    (tmp_path / "head.pt").write_bytes(b"x")
    (tmp_path / "README.md").write_text("---\nlicense: apache-2.0\nbase_model: Qwen/Qwen3-8B\ntags:\n- a\n---\nbody")
    d = detect(str(tmp_path))
    assert (d.backend, d.base_model, d.heads_file, d.license) == (Backend.CLM, "Qwen/Qwen3-8B", "head.pt", "apache-2.0")


def test_detect_unsupported(tmp_path):
    (tmp_path / "adapter_config.json").write_text("{}")
    assert detect(str(tmp_path)).backend == Backend.UNSUPPORTED
    (tmp_path / "adapter_config.json").unlink()
    (tmp_path / "config.json").write_text(json.dumps({"architectures": ["BertModel"]}))
    assert detect(str(tmp_path)).backend == Backend.UNSUPPORTED


def test_front_matter():
    assert _front_matter("no front matter") == {}
    assert _front_matter("---\na: b\nlist:\n- x\n---\n")["a"] == "b"


def test_store_add_get_and_errors(tmp_path):
    (tmp_path / "config.json").write_text(json.dumps({"architectures": ["LlamaForCausalLM"]}))
    s = ModelStore("cpu")
    e = s.add(str(tmp_path), name="m")
    assert s.default == "m" and e.status == "registered" and e.device == "cpu"
    assert s.get(None) is e
    with pytest.raises(ModelError):
        s.get("nope")
    bad = tmp_path / "bad"
    bad.mkdir()
    with pytest.raises(ModelError):
        s.add(str(bad))
    s.remove("m")
    assert s.default is None


def test_alias_and_specs():
    assert alias_for("Qwen/Qwen3-0.6B") == "qwen3-0.6b"
    assert parse_model_specs("a=Qwen/X;org/y;/tmp/z") == [("a", "Qwen/X"), (None, "org/y"), (None, "/tmp/z")]


def test_describe_reports_max_options(tmp_path):
    (tmp_path / "config.json").write_text(json.dumps({"architectures": ["LlamaForCausalLM"]}))
    (tmp_path / "enc").mkdir()
    (tmp_path / "enc" / "rl_agent_config.json").write_text("{}")
    s = ModelStore("cpu")
    assert s.add(str(tmp_path), name="lm").describe()["max_options"] == 26
    assert s.add(str(tmp_path / "enc"), name="enc").describe()["max_options"] == 255


def test_home_page_has_a_badge_for_every_backend_the_store_can_report():
    """A backend missing from the page's QUALITY table once blanked the whole model list (the remote backend)."""
    import re
    from pathlib import Path

    from decida.runtime.detect import Backend

    html = (Path(__file__).parent.parent / "src/decida/web/index.html").read_text()
    table = re.search(r"const QUALITY=\{(.*?)\};", html, re.DOTALL).group(1)
    for backend in (Backend.ENCODER, Backend.CLM, Backend.LM, Backend.REMOTE):
        assert f"{backend}:[" in table, f"home page has no quality badge for backend {backend!r}"
    assert "QUALITY[" not in html.replace("const quality=b=>QUALITY[b]", ""), "use quality(backend), which has a fallback"
