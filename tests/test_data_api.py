"""Dataset and Wikispeedia endpoints: a clear 409 before the download, real data after, and downloads start in the background."""
import pytest
from fastapi.testclient import TestClient
from test_datasets import (
    Server,
    make_tar,
)
from test_wikispeedia import (
    wiki,  # noqa: F401  (the fixture that builds a tiny Wikispeedia on disk)
)

from decida import datasets as D
from decida.serve import api, data_api


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(data_api, "_wiki", None)
    return TestClient(api.app)


def test_missing_dataset_gives_409_with_a_way_forward(tmp_path, monkeypatch, client):
    monkeypatch.setenv("DECIDA_DATA_DIR", str(tmp_path))
    r = client.get("/v1/wikispeedia/pair")
    assert r.status_code == 409 and "not downloaded" in r.json()["detail"] and "/v1/datasets/wikispeedia/download" in r.json()["detail"]
    st = client.get("/v1/datasets/wikispeedia").json()
    assert st["present"] is False and st["state"] == "idle" and st["size"] > 800_000_000 and st["licence"]


def test_unknown_dataset_is_404(client):
    assert client.get("/v1/datasets/nope").status_code == 404
    assert client.post("/v1/datasets/nope/download").status_code == 404


def test_list_shows_wikispeedia(client):
    assert [d["id"] for d in client.get("/v1/datasets").json()["datasets"]] == ["wikispeedia"]


def test_game_data_endpoints(wiki, client):  # noqa: F811
    p = client.get("/v1/wikispeedia/pair", params={"seed": 3, "min_hops": 2, "max_hops": 3}).json()
    assert 2 <= p["hops"] <= 3 and client.get("/v1/wikispeedia/pair", params={"seed": 3, "min_hops": 2, "max_hops": 3}).json() == p
    a = client.get("/v1/wikispeedia/article", params={"title": "Alpha", "target": "Delta"}).json()
    assert a["hops_to_target"] == 2 and [l["title"] for l in a["links"]] == ["Beta", "Gamma"] and a["lead"].startswith("The alpha")
    assert client.get("/v1/wikispeedia/article", params={"title": "nope"}).status_code == 404
    m = client.get("/v1/wikispeedia/missions").json()["missions"]
    assert m and m[0]["start"] == "Alpha" and m[0]["hops"] == 2
    assert client.get("/v1/datasets/wikispeedia").json()["present"] is True


def test_search_page_and_asset_endpoints(wiki, client):  # noqa: F811
    assert client.get("/v1/wikispeedia/search", params={"q": "ga"}).json()["titles"] == ["Gamma"]
    assert client.get("/v1/wikispeedia/search", params={"q": "a"}).json()["titles"][:2] == ["Alpha", "Beta"]   # starts-with before contains
    assert client.get("/v1/wikispeedia/search", params={"q": "  "}).json()["titles"] == []
    pg = client.get("/v1/wikispeedia/page", params={"title": "Alpha"}).json()
    assert pg["category"] == "Science > Physics" and 'data-title="Beta"' in pg["html"] and 'src="/v1/wikispeedia/asset/images/1/a.jpg"' in pg["html"]
    assert "<script" not in pg["html"] and "hidden" not in pg["html"]
    assert client.get("/v1/wikispeedia/page", params={"title": "Zeta"}).status_code == 404
    img = client.get("/v1/wikispeedia/asset/images/1/a.jpg")
    assert img.status_code == 200 and img.content == b"JPEGDATA" and "max-age" in img.headers["cache-control"]
    for bad in ["images/../../articles", "..%2f..%2fsecret.jpg", "images/1/missing.jpg", "secret.jpg"]:
        assert client.get("/v1/wikispeedia/asset/" + bad).status_code == 404, bad


def test_download_endpoint_starts_and_reports(tmp_path, monkeypatch, client):
    monkeypatch.setenv("DECIDA_DATA_DIR", str(tmp_path / "d"))
    blob = make_tar({"a.txt": b"hi"})
    import hashlib
    import time
    part = D.Part("demo_part", "demo.tar.gz", len(blob), hashlib.sha256(blob).hexdigest())
    monkeypatch.setitem(D.REGISTRY, "demo", D.Dataset("demo", "Demo", "x", (part,), "l", "s", "c"))
    srv = Server({"demo.tar.gz": blob})
    monkeypatch.setattr(data_api, "downloads", D.Downloads(base_url=srv.url))
    try:
        assert client.post("/v1/datasets/demo/download").status_code == 200
        for _ in range(100):
            if client.get("/v1/datasets/demo").json()["present"]:
                break
            time.sleep(0.05)
        assert client.get("/v1/datasets/demo").json()["present"] is True
    finally:
        srv.close()
