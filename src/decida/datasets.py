"""Datasets that benches need at run time: a registry, a "is it here?" check, and a verified, resumable download.

Nothing is downloaded unless someone asks (a bench page, `decida data download`, or `ensure()`). Every archive is pinned
by size and SHA-256, downloaded to a `.part` file, verified, extracted safely into a temp folder and renamed into place,
so a crash never leaves a half-extracted dataset that looks complete. Data lands under `data_dir()`, never in git.
"""
from __future__ import annotations

import hashlib
import logging
import os
import shutil
import tarfile
import threading
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import BaseModel

log = logging.getLogger("decida.datasets")

Progress = Callable[[str, int, int], None]  # (part name, bytes done, bytes total)
CHUNK = 1 << 20


class DatasetError(RuntimeError):
    """A download, verification or extraction failed; the message says which part and why."""


@dataclass(frozen=True)
class Part:
    name: str            # also the folder it extracts to, under <data_dir>/<dataset id>/
    archive: str         # file name on the server
    size: int            # bytes, pinned
    sha256: str          # pinned


@dataclass(frozen=True)
class Dataset:
    id: str
    title: str
    base_url: str
    parts: tuple[Part, ...]
    licence: str
    source: str
    cite: str


WIKISPEEDIA = Dataset(
    id="wikispeedia",
    title="Wikispeedia (human navigation paths on Wikipedia for Schools)",
    base_url="https://snap.stanford.edu/data/wikispeedia",
    parts=(
        Part("wikispeedia_paths-and-graph", "wikispeedia_paths-and-graph.tar.gz", 9_901_821,
             "97697096f5d2dcb77aa69e3992305c6c561de89edb9fb10b5ad9feaf8ba534d5"),
        Part("plaintext_articles", "wikispeedia_articles_plaintext.tar.gz", 35_844_149,
             "8e43d12822d05746a59f7de8987ffd6eafa57d248303d1c02cfe85b519359dc1"),
        Part("wpcd", "wikispeedia_articles_html.tar.gz", 790_798_884,      # full HTML pages of the same 4,604 articles, with images
             "dcb152a882726f4accd42d5906260731dcc4e530d1937628a51c03c7f3b578df"),
    ),
    licence="Article text: Wikipedia for Schools 2007 selection (CC BY-SA 3.0 / GFDL). Paths and graph: SNAP, no separate "
            "licence stated; cite the papers. Downloaded at run time for evaluation, never redistributed or trained on.",
    source="https://snap.stanford.edu/data/wikispeedia.html",
    cite="West & Leskovec, Human Wayfinding in Information Networks, WWW 2012; West, Pineau & Precup, IJCAI 2009.",
)

REGISTRY: dict[str, Dataset] = {WIKISPEEDIA.id: WIKISPEEDIA}


class PartStatus(BaseModel):
    name: str
    size: int
    present: bool


class DatasetStatus(BaseModel):
    id: str
    title: str
    present: bool
    size: int
    licence: str
    source: str
    cite: str
    path: str
    parts: list[PartStatus]
    state: str = "idle"          # idle | downloading | error
    done: int = 0                # bytes so far, across parts, while downloading
    error: str | None = None


# Where datasets were kept before they moved under Decida's own folder; moved across once, on first use.
def _legacy_dir() -> Path:
    return Path.home() / ".cache" / "decida" / "data"


def data_dir() -> Path:
    """Where datasets live: $DECIDA_DATA_DIR if set, else ~/.decida/datasets (next to settings.json; $DECIDA_HOME moves both)."""
    env = os.environ.get("DECIDA_DATA_DIR")
    if env:
        return Path(env).expanduser()
    from decida import settings

    target = settings.home() / "datasets"
    legacy = _legacy_dir()
    if not target.exists() and legacy.is_dir() and legacy.resolve() != target.resolve():
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(legacy), str(target))     # a rename on the same disk, so it is instant
        log.info("moved the downloaded datasets from %s to %s", legacy, target)
    return target


def get(dataset_id: str) -> Dataset:
    try:
        return REGISTRY[dataset_id]
    except KeyError:
        raise DatasetError(f"unknown dataset {dataset_id!r}; known: {', '.join(sorted(REGISTRY))}") from None


def root(ds: Dataset) -> Path:
    return data_dir() / ds.id


def part_dir(ds: Dataset, part: Part) -> Path:
    return root(ds) / part.name


def _stamp(ds: Dataset, part: Part) -> Path:
    return root(ds) / f".ok-{part.name}"


def part_present(ds: Dataset, part: Part) -> bool:
    """A part counts as present only if its stamp (written after a verified extract) matches the pinned hash."""
    stamp = _stamp(ds, part)
    try:
        return part_dir(ds, part).is_dir() and stamp.read_text().strip() == part.sha256
    except OSError:
        return False


def is_present(dataset_id: str) -> bool:
    ds = get(dataset_id)
    return all(part_present(ds, p) for p in ds.parts)


def status(dataset_id: str) -> DatasetStatus:
    ds = get(dataset_id)
    parts = [PartStatus(name=p.name, size=p.size, present=part_present(ds, p)) for p in ds.parts]
    return DatasetStatus(id=ds.id, title=ds.title, present=all(p.present for p in parts), size=sum(p.size for p in ds.parts),
                         licence=ds.licence, source=ds.source, cite=ds.cite, path=str(root(ds)), parts=parts)


def _download(url: str, dest: Path, part: Part, progress: Progress | None) -> None:
    """Fetch `url` into `dest` (a .part file), resuming if some bytes are already there, then check size and hash."""
    have = dest.stat().st_size if dest.exists() else 0
    if have > part.size:
        dest.unlink()
        have = 0
    if have < part.size:   # a file that is already complete (a finished earlier attempt) only needs verifying
        req = urllib.request.Request(url, headers={"Range": f"bytes={have}-"} if have else {}, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                if have and resp.status != 206:   # the server ignored Range: start over
                    have = 0
                with open(dest, "ab" if have else "wb") as out:
                    done = have
                    while chunk := resp.read(CHUNK):
                        out.write(chunk)
                        done += len(chunk)
                        if progress:
                            progress(part.name, done, part.size)
        except OSError as exc:
            raise DatasetError(f"{part.name}: download failed ({exc}); run again to resume") from exc
    size = dest.stat().st_size
    if size != part.size:
        dest.unlink(missing_ok=True)
        raise DatasetError(f"{part.name}: expected {part.size} bytes, got {size}; removed the partial file")
    digest = hashlib.sha256()
    with open(dest, "rb") as f:
        while chunk := f.read(CHUNK):
            digest.update(chunk)
    if digest.hexdigest() != part.sha256:
        dest.unlink(missing_ok=True)
        raise DatasetError(f"{part.name}: SHA-256 mismatch (got {digest.hexdigest()[:12]}..., pinned {part.sha256[:12]}...)")


def safe_extract(archive: Path, into: Path) -> None:
    """Extract a tar.gz holding only regular files and folders that stay inside `into` (no links, no `..`, no absolute paths)."""
    into_r = into.resolve()
    with tarfile.open(archive, "r:gz") as tar:
        members = tar.getmembers()
        for m in members:
            if not (m.isfile() or m.isdir()):
                raise DatasetError(f"{archive.name}: refusing non-file entry {m.name!r}")
            if not (into_r / m.name).resolve().is_relative_to(into_r):
                raise DatasetError(f"{archive.name}: entry {m.name!r} escapes the target folder")
        tar.extractall(into, members=members, filter="data")
    for p in [into, *into.rglob("*")]:   # an odd archive can leave folders we cannot enter or delete; make everything ours to use
        p.chmod(p.stat().st_mode | (0o700 if p.is_dir() else 0o600))


def ensure(dataset_id: str, progress: Progress | None = None, base_url: str | None = None) -> Path:
    """Make sure every part is on disk and verified; download what is missing. Returns the dataset folder."""
    ds = get(dataset_id)
    base = (base_url or ds.base_url).rstrip("/")
    top = root(ds)
    top.mkdir(parents=True, exist_ok=True)
    for part in ds.parts:
        if part_present(ds, part):
            continue
        log.info("downloading %s/%s (%d bytes)", ds.id, part.name, part.size)
        archive = top / f"{part.archive}.part"
        _download(f"{base}/{part.archive}", archive, part, progress)
        tmp = top / f".extract-{part.name}"
        shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir()
        try:
            safe_extract(archive, tmp)
            inner = tmp / part.name
            if not inner.is_dir():
                raise DatasetError(f"{part.name}: the archive does not contain a {part.name}/ folder")
            shutil.rmtree(part_dir(ds, part), ignore_errors=True)
            inner.rename(part_dir(ds, part))
            _stamp(ds, part).write_text(part.sha256)
        except (tarfile.TarError, OSError) as exc:
            raise DatasetError(f"{part.name}: could not extract ({exc})") from exc
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
            archive.unlink(missing_ok=True)
    return top


class Downloads:
    """Background downloads for the server: one job per dataset, with progress a page can poll."""

    def __init__(self, base_url: str | None = None):
        self._base = base_url
        self._lock = threading.Lock()
        self._jobs: dict[str, dict[str, Any]] = {}

    def start(self, dataset_id: str) -> DatasetStatus:
        get(dataset_id)
        with self._lock:
            running = self._jobs.get(dataset_id)
            if running and running["state"] == "downloading":
                return self.status(dataset_id)
            if is_present(dataset_id):
                return self.status(dataset_id)
            job: dict[str, Any] = {"state": "downloading", "done": {}, "error": None}
            self._jobs[dataset_id] = job
        threading.Thread(target=self._run, args=(dataset_id, job), name=f"download-{dataset_id}", daemon=True).start()
        return self.status(dataset_id)

    def _run(self, dataset_id: str, job: dict[str, Any]) -> None:
        def progress(name: str, done: int, total: int) -> None:
            job["done"][name] = done
        try:
            ensure(dataset_id, progress, self._base)
            job["state"] = "idle"
        except DatasetError as exc:
            log.warning("download of %s failed: %s", dataset_id, exc)
            job["state"], job["error"] = "error", str(exc)
        except Exception as exc:  # a background thread must never die silently
            log.exception("download of %s crashed", dataset_id)
            job["state"], job["error"] = "error", f"{type(exc).__name__}: {exc}"

    def status(self, dataset_id: str) -> DatasetStatus:
        st = status(dataset_id)
        job = self._jobs.get(dataset_id)
        if job:
            st.state, st.error, st.done = job["state"], job["error"], sum(job["done"].values())
        return st
