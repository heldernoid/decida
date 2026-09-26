"""Work out which backend can serve a model reference (local dir or Hugging Face repo id).

Detection reads file names and small config files only; it never executes repo code.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from decida.runtime.refs import split_ref


class Backend:
    ENCODER = "encoder"
    CLM = "clm"
    LM = "lm"
    REMOTE = "remote"
    UNSUPPORTED = "unsupported"


@dataclass
class Detection:
    backend: str
    reason: str
    ref: str
    heads_file: str | None = None  # clm: the head .pt file
    base_model: str | None = None  # clm: encoder repo id
    quality_mode: str = "zero-shot"  # or "specialist"
    calibrated: bool = False
    license: str | None = None
    extra: dict = field(default_factory=dict)


_LM_ARCH_SUFFIXES = ("ForCausalLM", "ForConditionalGeneration", "LMHeadModel")


def _local_files(path: Path) -> list[str]:
    return sorted(str(p.relative_to(path)) for p in path.rglob("*") if p.is_file() and ".git" not in p.parts)


def _read_json_local(path: Path, name: str) -> dict:
    f = path / name
    return json.loads(f.read_text()) if f.exists() else {}


def _hf_files(repo: str, revision: str | None, folder: str | None = None) -> list[str]:
    """The file names in a Hub repo, or in one folder of it (names relative to that folder)."""
    from huggingface_hub import list_repo_files

    files = list_repo_files(repo, revision=revision)
    if not folder:
        return files
    prefix = folder.rstrip("/") + "/"
    return [f[len(prefix):] for f in files if f.startswith(prefix)]


def _read_json_hf(repo: str, name: str, revision: str | None, folder: str | None = None) -> dict:
    from huggingface_hub import hf_hub_download

    return json.loads(Path(hf_hub_download(repo, f"{folder}/{name}" if folder else name, revision=revision)).read_text())


def _hf_license(repo: str) -> str | None:
    try:
        from huggingface_hub import model_info

        return getattr(model_info(repo).card_data, "license", None)
    except Exception:  # noqa: BLE001
        return None


def _front_matter(text: str) -> dict[str, str]:
    """Scalar `key: value` pairs from the README YAML front matter (enough for base_model / license)."""
    if not text.startswith("---"):
        return {}
    out: dict[str, str] = {}
    for line in text.split("---", 2)[1].splitlines():
        if ":" in line and not line.startswith((" ", "-")):
            k, v = line.split(":", 1)
            if v.strip():
                out[k.strip()] = v.strip()
    return out


def _readme_meta(ref: str, local: Path | None, revision: str | None) -> dict[str, str]:
    try:
        if local is not None:
            f = local / "README.md"
            return _front_matter(f.read_text()) if f.exists() else {}
        from huggingface_hub import hf_hub_download

        return _front_matter(Path(hf_hub_download(ref, "README.md", revision=revision)).read_text())
    except Exception:  # noqa: BLE001
        return {}


def _detect_remote(ref: str) -> Detection:
    """A hosted endpoint: `https://host/v1/systemone` with an optional `?model=name` (default jev-latest)."""
    from urllib.parse import parse_qs, urlparse

    u = urlparse(ref)
    local = u.hostname in ("localhost", "127.0.0.1", "::1")
    if u.scheme == "http" and not local:
        return Detection(Backend.UNSUPPORTED, "plain http is only allowed for localhost: the API key would travel unencrypted", ref)
    model = (parse_qs(u.query).get("model") or ["jev-latest"])[0]
    url = f"{u.scheme}://{u.netloc}{u.path}"
    return Detection(Backend.REMOTE, f"hosted endpoint {u.netloc}: requests are forwarded, metered by a USD cap", ref,
                     quality_mode="hosted (third-party)", license="service terms apply", extra={"url": url, "remote_model": model})


def detect(ref: str, revision: str | None = None) -> Detection:
    """Classify `ref` as encoder / clm / lm / remote / unsupported, with the reason."""
    if ref.startswith(("http://", "https://")):
        return _detect_remote(ref)
    repo, folder = split_ref(ref)                    # `org/name:folder` picks one checkpoint out of a repo that holds several
    local = Path(repo).expanduser()
    is_local = local.exists()
    if is_local:
        local = local / folder if folder else local
        files = _local_files(local)
        read = lambda n: _read_json_local(local, n)
        license_ = None
    else:
        files = _hf_files(repo, revision, folder)
        read = lambda n: _read_json_hf(repo, n, revision, folder)
        license_ = _hf_license(repo)
    if folder and not files:
        return Detection(Backend.UNSUPPORTED, f"{repo} has no folder {folder!r}", ref, license=license_)
    names = set(files)

    if "rl_agent_config.json" in names:
        return Detection(Backend.ENCODER, "rl_agent_config.json present (Decida/Laya encoder checkpoint)", ref,
                         quality_mode="specialist", calibrated=True, license=license_)

    if "adapter_config.json" in names and "config.json" not in names:
        return Detection(Backend.UNSUPPORTED, "LoRA/PEFT adapter without a base config: not supported yet", ref, license=license_)

    pt = [f for f in files if f.endswith(".pt") and "/" not in f]
    if pt:
        meta = _readme_meta(repo, local if is_local else None, revision)
        base = meta.get("base_model")
        license_ = license_ or meta.get("license")
        return Detection(Backend.CLM, "head .pt file found (frozen encoder + trained heads)", ref,
                         heads_file=pt[0], base_model=base, quality_mode="zero-shot", license=license_)

    if "config.json" in names:
        archs = read("config.json").get("architectures") or []
        if any(a.endswith(_LM_ARCH_SUFFIXES) for a in archs):
            return Detection(Backend.LM, f"causal LM ({archs[0]}); read via option-letter logits", ref, license=license_)
        return Detection(Backend.UNSUPPORTED, f"architecture {archs or 'unknown'} is not a causal LM", ref, license=license_)

    return Detection(Backend.UNSUPPORTED, "no config.json, rl_agent_config.json or head .pt found", ref, license=license_)
