from pathlib import Path

import pytest
from pydantic import ValidationError

from decida.schema import Request, Response

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "api"

def test_request_fixture_1():
    with open(FIXTURES_DIR / "request_example1.json") as f:
        data = f.read()
    req = Request.model_validate_json(data)
    assert req.model == "decida-latest"
    assert "is_urgent" in req.questions
    # Test round trip
    dump = req.model_dump_json(exclude_none=True)
    assert Request.model_validate_json(dump) == req

def test_response_fixture_1():
    with open(FIXTURES_DIR / "response_example1.json") as f:
        data = f.read()
    res = Response.model_validate_json(data)
    assert res.model == "decida-enc-0.1.0"
    assert res.answers["is_urgent"].type == "noul"
    assert res.answers["department"].type == "choice"
    dump = res.model_dump_json(exclude_none=True)
    assert Response.model_validate_json(dump) == res

def test_request_fixture_2():
    with open(FIXTURES_DIR / "request_example2.json") as f:
        data = f.read()
    req = Request.model_validate_json(data)
    assert req.questions["is_urgent"].type == "noul"

def test_response_fixture_2():
    with open(FIXTURES_DIR / "response_example2.json") as f:
        data = f.read()
    res = Response.model_validate_json(data)
    assert res.answers["is_urgent"].type == "noul"

def test_invalid_score_dict():
    data = {
        "model": "test",
        "state": "test state",
        "questions": {
            "q": {"type": "score", "instructions": "test", "criteria": {"1": "a"}}
        }
    }
    with pytest.raises(ValidationError) as excinfo:
        Request.model_validate(data)
    assert "criteria" in str(excinfo.value)

def test_choice_single_option():
    data = {
        "model": "test",
        "state": "test state",
        "questions": {
            "q": {"type": "choice", "instructions": "test", "criteria": {"opt1": "desc"}}
        }
    }
    with pytest.raises(ValidationError) as excinfo:
        Request.model_validate(data)
    assert "choice must have 2 to 255 options" in str(excinfo.value)

