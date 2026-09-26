import asyncio

from decida.checks import CHECKS, judge, request_for, run_checks
from decida.schema.primitives import Primitive
from decida.serve.engine import SystemOneRequest


def perfect(req):
    """A fake model that answers every check correctly, built from the expected values."""
    c = next(c for c in CHECKS if c.state == req["state"])
    q = c.kind
    if q == Primitive.CHOICE:
        probs = {k: (0.8 if k == c.expected else 0.2 / (len(c.criteria) - 1)) for k in c.criteria}
        a = {"type": "choice", "probabilities": probs, "choice": c.expected}
    elif q == Primitive.SCORE:
        n = len(c.criteria)
        probs = {str(i): (0.8 if i == c.expected else 0.2 / (n - 1)) for i in range(n)}
        a = {"type": "score", "probabilities": probs, "score": float(c.expected)}
    else:
        a = {"type": "noul", "noul": 0.9 if c.expected else 0.1}
    return {"answers": {"q": a}}


def test_fourteen_valid_checks():
    assert len(CHECKS) == 14 and len({c.id for c in CHECKS}) == 14
    for c in CHECKS:
        SystemOneRequest({"model": "m", **request_for(c)})  # passes serving validation


def test_perfect_model_passes():
    async def p(req):
        return perfect(req)
    res = asyncio.run(run_checks(p))
    assert (res["wiring_ok"], res["correct"], res["passed"]) == (14, 14, True)


def test_wrong_but_wellformed_is_wiring_ok_not_correct():
    c = CHECKS[0]
    resp = {"answers": {"q": {"type": "choice", "choice": "sales", "probabilities": {"billing": 0.1, "technical": 0.1, "sales": 0.8}}}}
    r = judge(c, resp)
    assert r["wiring"] and not r["correct"]


def test_malformed_responses_fail_wiring():
    c = CHECKS[0]
    assert not judge(c, {})["wiring"]
    assert not judge(c, {"answers": {"q": {"type": "noul", "noul": 0.5}}})["wiring"]
    bad = {"answers": {"q": {"type": "choice", "choice": "billing", "probabilities": {"billing": 0.9, "technical": 0.9, "sales": 0.9}}}}
    assert not judge(c, bad)["wiring"]
