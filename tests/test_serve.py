import json

import pytest
from fastapi.testclient import TestClient

from decida.serve import api
from decida.serve.api import app
from decida.serve.engine import SystemOneRequest


class MockEngine:
    def __init__(self):
        self.model = type('obj', (object,), {'family': 'enc'})
        self._queue = []
        self.predict_called = False
        
    async def predict_async(self, req: SystemOneRequest):
        self.predict_called = True
        # Just return a dummy structure
        return {
            "model": req.model,
            "answers": {k: {"type": v["type"], "confidence": 0.9} for k, v in req.questions.items()},
            "usage": {"input_tokens": 10, "output_tokens": 0}
        }


@pytest.fixture
def client():
    from decida.runtime.detect import Backend, Detection
    from decida.runtime.store import ModelEntry, ModelStore
    api.store = ModelStore("cpu")
    det = Detection(Backend.ENCODER, "mock", "mock")
    api.store.entries["decida-latest"] = ModelEntry("decida-latest", "mock", det, "cpu", status="ready", engine=MockEngine())
    api.store.default = "decida-latest"
    return TestClient(app)


def test_healthz(client):
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_models(client):
    resp = client.get("/v1/models")
    assert resp.status_code == 200
    assert "models" in resp.json()


def test_systemone_positive_fixture_1(client):
    with open("tests/fixtures/api/pos_req_1.json") as f:
        req = json.load(f)
    resp = client.post("/v1/systemone", json=req)
    assert resp.status_code == 200
    data = resp.json()
    assert data["model"] == "decida-latest"
    assert "is_urgent" in data["answers"]


def test_systemone_positive_fixture_2(client):
    with open("tests/fixtures/api/pos_req_2.json") as f:
        req = json.load(f)
    resp = client.post("/v1/systemone", json=req)
    assert resp.status_code == 200
    data = resp.json()
    assert "department" in data["answers"]
    assert "frustration" in data["answers"]


# Negative fixtures
def test_negative_score_dict(client):
    req = {
        "model": "decida-latest",
        "state": "test",
        "questions": {
            "q": {"type": "score", "instructions": "t", "criteria": {"1": "bad"}}
        }
    }
    resp = client.post("/v1/systemone", json=req)
    assert resp.status_code == 422
    assert resp.json()["error"]["message"].find("must be a list") != -1


def test_negative_choice_one_option(client):
    req = {
        "model": "decida-latest",
        "state": "test",
        "questions": {
            "q": {"type": "choice", "instructions": "t", "criteria": {"1": "bad"}}
        }
    }
    resp = client.post("/v1/systemone", json=req)
    assert resp.status_code == 422
    assert resp.json()["error"]["message"].find("must have 2-255 options") != -1


def test_negative_empty_instructions(client):
    req = {
        "model": "decida-latest",
        "state": "test",
        "questions": {
            "q": {"type": "noul", "instructions": ""}
        }
    }
    resp = client.post("/v1/systemone", json=req)
    assert resp.status_code == 422
    assert resp.json()["error"]["message"].find("instructions is required") != -1


def test_negative_unknown_type(client):
    req = {
        "model": "decida-latest",
        "state": "test",
        "questions": {
            "q": {"type": "unknown", "instructions": "t"}
        }
    }
    resp = client.post("/v1/systemone", json=req)
    assert resp.status_code == 422
    assert resp.json()["error"]["message"].find("Unknown question type") != -1


def test_negative_257_questions(client):
    req = {
        "model": "decida-latest",
        "state": "test",
        "questions": {str(i): {"type": "noul", "instructions": "t"} for i in range(257)}
    }
    resp = client.post("/v1/systemone", json=req)
    assert resp.status_code == 422
    assert resp.json()["error"]["message"].find("must have 1-256 entries") != -1


def test_health_alias_and_model_field_optional(client):
    assert client.get("/health").status_code == 200
    body = {"state": "s", "questions": {"q": {"type": "noul", "instructions": "ok?"}}}
    resp = client.post("/v1/systemone", json=body)
    assert resp.status_code == 200
    data = resp.json()
    assert data["model"] == "decida-latest"
    assert "latency_ms" in data


def test_choice_criteria_bare_list_is_normalized():
    from decida.serve.engine import normalize_criteria
    assert normalize_criteria("choice", ["a", "b"]) == {"a": "", "b": ""}
    assert normalize_criteria("choice", {"a": "x"}) == {"a": "x"}
    assert normalize_criteria("score", ["lo", "hi"]) == ["lo", "hi"]


def test_home_page_and_benches(client):
    r = client.get("/")
    assert r.status_code == 200 and "Decida" in r.text
    ids = [b["id"] for b in client.get("/v1/benches").json()["benches"]]
    assert {"wikispeedia", "town", "compare"} <= set(ids) and "wikispeedia-eval" not in ids, "the batch eval page is hidden from the list"
    home = client.get("/").text
    for bench in ids:   # every listed bench has a card on the home page, and every card points at a real bench
        assert f"id:'{bench}'" in home, f"{bench} has no card on the home page"
    import re
    for card in re.findall(r"\{id:'([a-z-]+)',title:", home):
        if card != "check":
            assert card in ids, f"the home page has a card for {card} but no such bench is installed"
    assert client.get("/bench/wikispeedia-eval/").status_code == 200, "but still served at its URL"
    page = client.get("/bench/wikispeedia/").text
    assert "Random mission" in page and "Start article" in page and "Seed" not in page.split("<details class=\"adv\">")[0]


def test_check_endpoint_runs_all_checks(client):
    # the mock engine returns no probabilities, so wiring must fail rather than crash
    r = client.post("/v1/check", json={"model": "decida-latest"})
    assert r.status_code == 200
    assert r.json()["total"] == 14 and r.json()["passed"] is False


def test_structured_values_are_coerced_for_local_engines_but_not_remote():
    from decida.serve.engine import coerce_for_local
    body = {"state": {"ticket": "charged twice", "n": 2}, "questions": {
        "q": {"type": "choice", "instructions": {"task": "Which team?"}, "criteria": {"a": {"does": "bugs"}, "b": "billing"}},
        "s": {"type": "score", "instructions": "How bad?", "criteria": ["ok", {"level": "bad"}]}}}
    out = coerce_for_local(body)
    assert out["state"] == '{"ticket":"charged twice","n":2}'
    q = out["questions"]["q"]
    assert q["instructions"] == '{"task":"Which team?"}' and q["criteria"] == {"a": '{"does":"bugs"}', "b": "billing"}
    assert out["questions"]["s"]["criteria"] == ["ok", '{"level":"bad"}']
    assert body["state"] == {"ticket": "charged twice", "n": 2}, "the input is not modified"
    assert coerce_for_local({"state": "plain", "questions": {}})["state"] == "plain"


def test_api_coerces_for_local_models_and_forwards_raw_to_remote(client):
    body = {"model": "decida-latest", "state": {"a": 1}, "questions": {"q": {"type": "noul", "instructions": {"task": "ok?"}}}}
    assert client.post("/v1/systemone", json=body).status_code == 200  # local mock engine: object instructions no longer break validation
    seen = {}

    class Remote:
        async def predict_async(self, req):
            seen["state"], seen["instr"] = req.state, req.questions["q"]["instructions"]
            return {"model": req.model, "answers": {}, "usage": {"input_tokens": 1, "output_tokens": 0}}

    from decida.runtime.detect import Backend, Detection
    from decida.runtime.store import ModelEntry
    api.store.entries["jev"] = ModelEntry("jev", "https://x/v1/systemone", Detection(Backend.REMOTE, "t", "x"), "cpu", status="ready", engine=Remote())
    assert client.post("/v1/systemone", json={**body, "model": "jev"}).status_code == 200
    assert seen["state"] == {"a": 1} and seen["instr"] == {"task": "ok?"}, "remote gets the structured values untouched"


def test_ui_files_are_served_with_no_cache(client):
    for path in ("/", "/bench/dino/game.js", "/bench/common/rng.js", "/bench/tetris/index.html"):
        r = client.get(path)
        assert r.status_code == 200, path
        assert r.headers["cache-control"] == "no-cache", path


def test_unknown_model_is_a_404_even_with_a_single_model_loaded(client):
    """A benchmark must never silently run on a different model than the one it asked for."""
    body = {"state": "s", "questions": {"q": {"type": "noul", "instructions": "ok?"}}}
    r = client.post("/v1/systemone", json={**body, "model": "qwen"})
    assert r.status_code == 404
    err = r.json()["error"]
    assert err["type"] == "model_error" and "qwen" in err["message"] and err["models"] == ["decida-latest"]
    for generic in ("decida-latest", "decida", "decida-enc-0.1.0", "default", "latest"):  # what Jev-shaped clients and the MCP server send
        assert client.post("/v1/systemone", json={**body, "model": generic}).status_code == 200, generic
    assert client.post("/v1/systemone", json=body).status_code == 200  # no model at all: the default


def test_every_nav_item_is_its_own_url_served_with_the_home_page(client):
    import re

    from decida.serve.api import PAGES
    html = client.get("/").text
    nav = re.search(r'<nav aria-label="Sections">(.*?)</nav>', html, re.DOTALL).group(1)
    hrefs = re.findall(r'href="(/[^"]*)"', nav)
    sections = set(re.findall(r'<section[^>]*data-page="([^"]+)"', html))
    assert hrefs and all(h in PAGES for h in hrefs), "every nav link is a server route"
    assert {h.lstrip("/") for h in hrefs} <= sections, "and has a section to show"
    assert "home" in sections
    js_pages = dict(re.findall(r"'(/[^']*)':'([^']+)'", re.search(r"var PAGES=\{(.*?)\};", html).group(1)))
    assert set(js_pages) == set(PAGES), "the page script and the server list the same URLs"
    assert {v for v in js_pages.values()} == sections, "and every URL has exactly one section"
    for path in PAGES:
        r = client.get(path)
        assert r.status_code == 200 and "Decida" in r.text and r.text == html, path
    assert 'href="#' not in nav, "no in-page anchors left in the nav"


def test_batch_endpoint_answers_many_requests_in_one_call(client):
    one = {"state": "s", "questions": {"q": {"type": "noul", "instructions": "?"}}}
    r = client.post("/v1/systemone/batch", json={"model": "decida-latest", "requests": [one, one, one]})
    assert r.status_code == 200
    body = r.json()
    assert body["model"] == "decida-latest" and len(body["responses"]) == 3 and body["latency_ms"] >= 0
    assert all("answers" in x and x["latency_ms"] >= 0 for x in body["responses"])


def test_batch_errors_stay_in_their_slot_and_bad_calls_are_refused(client):
    good = {"state": "s", "questions": {"q": {"type": "noul", "instructions": "?"}}}
    bad = {"state": "s", "questions": {"q": {"type": "nope", "instructions": "?"}}}
    r = client.post("/v1/systemone/batch", json={"model": "decida-latest", "requests": [good, bad, "not an object", good]})
    assert r.status_code == 200
    out = r.json()["responses"]
    assert "answers" in out[0] and "answers" in out[3]
    assert "Unknown question type" in out[1]["error"]["message"] and "object" in out[2]["error"]["message"]
    assert client.post("/v1/systemone/batch", json={"model": "decida-latest", "requests": []}).status_code == 422
    assert client.post("/v1/systemone/batch", json={"model": "decida-latest", "requests": [good] * 257}).status_code == 422
    assert client.post("/v1/systemone/batch", json={"model": "decida-latest"}).status_code == 422
    assert client.post("/v1/systemone/batch", json={"model": "no-such-model", "requests": [good]}).status_code == 404


def test_benches_built_on_someone_elses_idea_credit_them_on_the_page(client):
    credits = {"sorter": ["Matthew Berman", "2z-7pIj57f8"], "town": ["Matthew Berman", "2z-7pIj57f8"],
               "palette": ["Matt DesLauriers", "@mattdesl", "x.com/mattdesl/status/2100899669802963060"],
               "emoji": ["Stefan", "@heystefan_", "x.com/heystefan_"]}
    for bench, needles in credits.items():
        page = client.get(f"/bench/{bench}/").text
        for n in needles:
            assert n in page, f"{bench}: missing {n!r}"
        assert "TypeSafe's public" not in page and "TypeSafe's \"AI Town\"" not in page, f"{bench}: still credits the wrong source"
    with open("THIRD_PARTY.md", encoding="utf-8") as f:
        notes = f.read()
    assert notes.count("Matthew Berman") >= 2 and "@mattdesl" in notes and "@heystefan_" in notes and "no source code" in notes.lower()
