"""Model references: a local folder, a Hugging Face repo id, or a folder inside a repo (`org/name:folder`).

Some repos hold several checkpoints side by side (for example `helmo/laya` has the English model at the root, and `multilingual/` and
`typed-decisions/` folders). `org/name:folder` picks one. Everything that needs files on disk goes through `local_dir`, so the Hub is
only ever touched in one place.
"""
from __future__ import annotations

import re
from pathlib import Path, PurePosixPath

_HUB_WITH_FOLDER = re.compile(r"^([A-Za-z0-9][\w.-]*/[\w.-]+):([\w.-]+(?:/[\w.-]+)*)$")


def is_url(ref: str) -> bool:
    return ref.startswith(("http://", "https://"))


def split_ref(ref: str) -> tuple[str, str | None]:
    """`org/name:folder` -> (`org/name`, `folder`). A local folder, a URL, or a plain repo id comes back unchanged with no folder."""
    if is_url(ref) or Path(ref).expanduser().exists():
        return ref, None
    left, _, right = ref.rpartition(":")
    if left and right and Path(left).expanduser().is_dir():   # a local checkpoint folder: /path/to/laya:multilingual
        return left, right
    m = _HUB_WITH_FOLDER.match(ref)
    return (m.group(1), m.group(2)) if m else (ref, None)


def alias_for(ref: str) -> str:
    """A short default name for a model: the last part of the repo id, plus the folder when there is one (`laya-typed-decisions`)."""
    repo, folder = split_ref(ref)
    name = repo.rstrip("/").split("/")[-1].lower()
    return f"{name}-{folder.replace('/', '-').lower()}" if folder else name


def cached_snapshot(repo: str, revision: str | None = None) -> Path | None:
    """The local Hugging Face cache's snapshot folder for `repo` (a specific `revision`, or its most recently
    touched one), or None if `repo` is not cached at all. Lets a fully-downloaded model be detected without any
    network call: `detect()` uses this so `decida serve` on an already-pulled model works offline, instead of
    `list_repo_files` (no local equivalent to fall back to, unlike `snapshot_download`) failing the whole thing
    before a single byte is even read from disk.
    """
    try:
        from huggingface_hub import scan_cache_dir
        from huggingface_hub.errors import CacheNotFound
    except ImportError:
        return None
    try:
        info = scan_cache_dir()
    except CacheNotFound:
        return None
    for r in info.repos:
        if r.repo_type != "model" or r.repo_id != repo:
            continue
        if revision is None:
            return max(r.revisions, key=lambda rev: rev.last_modified).snapshot_path
        return next((rev.snapshot_path for rev in r.revisions if revision in (rev.commit_hash, *rev.refs)), None)
    return None


def local_dir(ref: str, revision: str | None = None) -> Path:
    """The folder on disk that holds the model files for `ref`, downloading them from the Hub if needed (cached after the first time).

    Only the folder asked for is downloaded, so `helmo/laya:multilingual` does not fetch the other two checkpoints.
    Already fully pulled: returned straight from the cache, no network call (see `cached_snapshot`).
    """
    repo, folder = split_ref(ref)
    local = Path(repo).expanduser()
    if local.exists():
        return local / folder if folder else local
    cached = cached_snapshot(repo, revision)
    if cached is not None:
        path = cached / folder if folder else cached
        if path.is_dir() and any(path.iterdir()):
            return path
    from huggingface_hub import snapshot_download

    if folder:
        root = Path(snapshot_download(repo, revision=revision, allow_patterns=[f"{folder}/*", f"{folder}/**"]))
        path = root / folder
        if not path.is_dir():
            raise FileNotFoundError(f"{repo} has no folder {folder!r}")
        return path
    # The root checkpoint must not pull in the other checkpoints stored in sub-folders of the same repo.
    return Path(snapshot_download(repo, revision=revision, ignore_patterns=_other_checkpoints(repo, revision)))


def _other_checkpoints(repo: str, revision: str | None) -> list[str]:
    """Patterns for every sub-folder of `repo` that holds a checkpoint of its own (a model.safetensors or rl_agent_config.json)."""
    from huggingface_hub import list_repo_files

    folders = {PurePosixPath(f).parent for f in list_repo_files(repo, revision=revision)
               if PurePosixPath(f).name in ("model.safetensors", "rl_agent_config.json")}
    return [pat for d in sorted(folders) if str(d) != "." for pat in (f"{d}/*", f"{d}/**")]
