"""Dataset manager: check, download, verify, extract safely, resume, never leave a half-done dataset that looks complete."""
import hashlib
import http.server
import io
import tarfile
import threading
import time
from pathlib import Path

import pytest

from decida import datasets as D


def make_tar(files: dict[str, bytes], folder: str = "demo_part", extra=None) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        d = tarfile.TarInfo(folder + "/"); d.type = tarfile.DIRTYPE; tar.addfile(d)
        for name, data in files.items():
            info = tarfile.TarInfo(f"{folder}/{name}"); info.size = len(data); tar.addfile(info, io.BytesIO(data))
        if extra:
            extra(tar)
    return buf.getvalue()


class Server:
    """Serves {name: bytes}, counts requests, and (like a simple static server) ignores Range headers."""

    def __init__(self, blobs: dict[str, bytes]):
        outer = self
        self.hits: list[str] = []

        class H(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                outer.hits.append(self.path)
                blob = blobs.get(self.path.lstrip("/"))
                if blob is None:
                    self.send_error(404); return
                self.send_response(200); self.send_header("Content-Length", str(len(blob))); self.end_headers(); self.wfile.write(blob)

            def log_message(self, *a): pass

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self):
        self.httpd.shutdown(); self.httpd.server_close()


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("DECIDA_DATA_DIR", str(tmp_path / "data"))
    blob = make_tar({"a.txt": b"hello", "b.tsv": b"x\ty\n"})
    part = D.Part("demo_part", "demo.tar.gz", len(blob), hashlib.sha256(blob).hexdigest())
    ds = D.Dataset("demo", "Demo", "http://unused", (part,), "test licence", "http://src", "cite")
    monkeypatch.setitem(D.REGISTRY, "demo", ds)
    srv = Server({"demo.tar.gz": blob})
    yield ds, part, blob, srv
    srv.close()


def test_status_reports_missing_then_present(env):
    _ds, part, _blob, srv = env
    st = D.status("demo")
    assert not st.present and st.parts[0].present is False and st.size == part.size
    D.ensure("demo", base_url=srv.url)
    st = D.status("demo")
    assert st.present and (Path(st.path) / "demo_part" / "a.txt").read_bytes() == b"hello"
    assert D.is_present("demo")


def test_second_ensure_makes_no_request(env):
    _ds, _part, _blob, srv = env
    D.ensure("demo", base_url=srv.url)
    n = len(srv.hits)
    D.ensure("demo", base_url=srv.url)
    assert len(srv.hits) == n == 1


def test_hash_mismatch_is_rejected_and_leaves_nothing(env):
    _ds, _part, blob, srv = env
    bad = bytes([blob[0] ^ 1]) + blob[1:]    # same size, different content
    srv.close(); srv2 = Server({"demo.tar.gz": bad})
    try:
        with pytest.raises(D.DatasetError, match="SHA-256"):
            D.ensure("demo", base_url=srv2.url)
    finally:
        srv2.close()
    assert not D.is_present("demo")
    assert not any(p.name.endswith(".part") for p in (D.data_dir() / "demo").iterdir())


def test_wrong_size_is_rejected(env):
    _ds, _part, blob, srv = env
    srv.close(); srv2 = Server({"demo.tar.gz": blob[:-5]})
    try:
        with pytest.raises(D.DatasetError, match="expected"):
            D.ensure("demo", base_url=srv2.url)
    finally:
        srv2.close()
    assert not D.is_present("demo")


def test_server_error_is_a_clear_error(env):
    _ds, _part, _blob, srv = env
    with pytest.raises(D.DatasetError, match="download failed"):
        D.ensure("demo", base_url=srv.url + "/nowhere")
    assert not D.is_present("demo")


def test_partial_file_is_completed_even_if_server_ignores_range(env):
    _ds, _part, blob, srv = env
    top = D.data_dir() / "demo"; top.mkdir(parents=True)
    (top / "demo.tar.gz.part").write_bytes(blob[:20])
    D.ensure("demo", base_url=srv.url)
    assert D.is_present("demo")


def test_a_complete_partial_file_is_verified_without_any_request(env):
    _ds, _part, blob, srv = env
    top = D.data_dir() / "demo"; top.mkdir(parents=True)
    (top / "demo.tar.gz.part").write_bytes(blob)            # a finished earlier download that was never extracted
    D.ensure("demo", base_url=srv.url)
    assert D.is_present("demo") and srv.hits == []


def test_path_traversal_and_links_are_refused(tmp_path):
    def evil(tar):
        info = tarfile.TarInfo("../escape.txt"); info.size = 1; tar.addfile(info, io.BytesIO(b"x"))
    p = tmp_path / "evil.tar.gz"; p.write_bytes(make_tar({"a": b"1"}, extra=evil))
    with pytest.raises(D.DatasetError, match="escapes"):
        D.safe_extract(p, tmp_path / "out")
    assert not (tmp_path / "escape.txt").exists()

    def link(tar):
        info = tarfile.TarInfo("demo_part/l"); info.type = tarfile.SYMTYPE; info.linkname = "/etc/passwd"; tar.addfile(info)
    p2 = tmp_path / "link.tar.gz"; p2.write_bytes(make_tar({"a": b"1"}, extra=link))
    with pytest.raises(D.DatasetError, match="non-file"):
        D.safe_extract(p2, tmp_path / "out2")


def test_tampered_stamp_or_missing_folder_means_not_present(env):
    _ds, _part, _blob, srv = env
    D.ensure("demo", base_url=srv.url)
    (D.data_dir() / "demo" / ".ok-demo_part").write_text("0" * 64)
    assert not D.is_present("demo")


def test_unknown_dataset_names_the_known_ones():
    with pytest.raises(D.DatasetError, match="wikispeedia"):
        D.get("nope")


def test_background_download_reports_progress_and_finishes(env):
    _ds, part, _blob, srv = env
    jobs = D.Downloads(base_url=srv.url)
    assert jobs.status("demo").state == "idle" and not jobs.status("demo").present
    jobs.start("demo")
    for _ in range(100):
        if jobs.status("demo").present:
            break
        time.sleep(0.05)
    st = jobs.status("demo")
    assert st.present and st.state == "idle" and st.done == part.size
    assert jobs.start("demo").present            # already there: no new job, no new request
    assert len(srv.hits) == 1


def test_background_failure_is_reported_not_raised(env):
    _ds, _part, _blob, srv = env
    jobs = D.Downloads(base_url=srv.url + "/nowhere")
    jobs.start("demo")
    for _ in range(100):
        if jobs.status("demo").state == "error":
            break
        time.sleep(0.05)
    st = jobs.status("demo")
    assert st.state == "error" and "download failed" in (st.error or "")


def test_pinned_wikispeedia_entries():
    ds = D.get("wikispeedia")
    assert [p.name for p in ds.parts] == ["wikispeedia_paths-and-graph", "plaintext_articles", "wpcd"]
    assert all(len(p.sha256) == 64 and p.size > 1_000_000 for p in ds.parts) and ds.base_url.startswith("https://")


# ---------- where the data lives ----------
def test_datasets_default_to_a_folder_under_decidas_own_home(tmp_path, monkeypatch):
    monkeypatch.delenv("DECIDA_DATA_DIR", raising=False)
    monkeypatch.setenv("DECIDA_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("HOME", str(tmp_path / "nobody"))
    assert D.data_dir() == tmp_path / "home" / "datasets"
    assert D.status("wikispeedia").path == str(tmp_path / "home" / "datasets" / "wikispeedia")


def test_the_environment_variable_still_wins(tmp_path, monkeypatch):
    monkeypatch.setenv("DECIDA_DATA_DIR", str(tmp_path / "elsewhere"))
    monkeypatch.setenv("DECIDA_HOME", str(tmp_path / "home"))
    assert D.data_dir() == tmp_path / "elsewhere"


def test_data_from_the_old_cache_location_is_moved_across_once(tmp_path, monkeypatch):
    monkeypatch.delenv("DECIDA_DATA_DIR", raising=False)
    monkeypatch.setenv("HOME", str(tmp_path / "user"))
    monkeypatch.setenv("DECIDA_HOME", str(tmp_path / "user" / ".decida"))
    old = tmp_path / "user" / ".cache" / "decida" / "data" / "wikispeedia"
    old.mkdir(parents=True)
    (old / "marker.txt").write_text("kept")
    new = D.data_dir()
    assert new == tmp_path / "user" / ".decida" / "datasets"
    assert (new / "wikispeedia" / "marker.txt").read_text() == "kept" and not old.exists()
    assert D.data_dir() == new, "a second call changes nothing"


def test_a_fresh_setup_creates_nothing_until_something_is_downloaded(tmp_path, monkeypatch):
    monkeypatch.delenv("DECIDA_DATA_DIR", raising=False)
    monkeypatch.setenv("DECIDA_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("HOME", str(tmp_path / "nobody"))
    D.data_dir()
    D.status("wikispeedia")
    assert not (tmp_path / "home").exists()
