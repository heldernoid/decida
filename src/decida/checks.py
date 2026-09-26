"""Smoke checks: 14 unambiguous tasks that any working decision model should get right.

Each check reports two things separately:
  wiring   the response is well-formed (right type, keys match the request, probabilities sum to 1)
  correct  the obvious answer won (choice: expected option is top; score: expected level is top;
           noul: probability on the expected side of 0.5)
Wiring must be 14/14 for a model to be considered correctly plugged in. Correctness is reported, not
enforced: a zero-shot generalist is allowed to miss some.
"""
from __future__ import annotations

import math
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from decida.schema.primitives import Primitive


@dataclass(frozen=True)
class Check:
    id: str
    kind: Primitive
    state: str
    instructions: str
    criteria: dict[str, str] | list[str] | None
    expected: str | int | bool  # choice: option key; score: level index; noul: True/False


CHECKS: list[Check] = [
    Check("route_billing", Primitive.CHOICE, "My invoice shows two charges for the same month and I want one refunded.",
          "Which team should handle this message?",
          {"billing": "Invoices, charges, refunds", "technical": "Bugs, errors, outages", "sales": "New purchases and pricing"}, "billing"),
    Check("route_technical", Primitive.CHOICE, "The app crashes with a 500 error every time I open the dashboard.",
          "Which team should handle this message?",
          {"billing": "Invoices, charges, refunds", "technical": "Bugs, errors, outages", "sales": "New purchases and pricing"}, "technical"),
    Check("route_sales", Primitive.CHOICE, "We are a 200-person company and would like a quote for the enterprise plan.",
          "Which team should handle this message?",
          {"billing": "Invoices, charges, refunds", "technical": "Bugs, errors, outages", "sales": "New purchases and pricing"}, "sales"),
    Check("sentiment_positive", Primitive.CHOICE, "Absolutely love it. Best purchase I have made all year, works perfectly!",
          "What is the sentiment of this review?",
          {"positive": "The author is happy", "negative": "The author is unhappy", "neutral": "No clear feeling"}, "positive"),
    Check("sentiment_negative", Primitive.CHOICE, "Terrible. It broke after two days and support ignored me. Total waste of money.",
          "What is the sentiment of this review?",
          {"positive": "The author is happy", "negative": "The author is unhappy", "neutral": "No clear feeling"}, "negative"),
    Check("tool_gate_block", Primitive.CHOICE, "Agent wants to run: rm -rf / --no-preserve-root on the production server.",
          "Should the agent be allowed to run this command?",
          {"allow": "Safe and routine", "confirm": "Ask a human first", "block": "Destructive, never run"}, "block"),
    Check("churn_high", Primitive.SCORE, "Customer cancelled twice this quarter, opened 6 angry tickets, and asked how to export all their data.",
          "How likely is this customer to churn?", ["Very unlikely", "Unlikely", "Possible", "Likely", "Almost certain"], 4),
    Check("churn_low", Primitive.SCORE, "Customer renewed for three years, uses the product daily and just referred two colleagues.",
          "How likely is this customer to churn?", ["Very unlikely", "Unlikely", "Possible", "Likely", "Almost certain"], 0),
    Check("urgency_high", Primitive.SCORE, "PRODUCTION IS DOWN. All customers are getting errors right now, we are losing money every minute.",
          "How urgent is this message?", ["Not urgent", "Somewhat urgent", "Very urgent"], 2),
    Check("urgency_low", Primitive.SCORE, "Just a thought: whenever you have time, the footer could use a slightly different shade of grey.",
          "How urgent is this message?", ["Not urgent", "Somewhat urgent", "Very urgent"], 0),
    Check("refund_yes", Primitive.NOUL, "I would like my money back, please refund order #4471.",
          "Is the customer asking for a refund?", None, True),
    Check("refund_no", Primitive.NOUL, "Thanks for the quick delivery, everything arrived in perfect condition.",
          "Is the customer asking for a refund?", None, False),
    Check("deadline_yes", Primitive.NOUL, "The report is due tomorrow at 9am and nothing has been written yet.",
          "Does this message mention a deadline?", None, True),
    Check("deadline_no", Primitive.NOUL, "The cafeteria now serves vegetarian lunch options on Fridays.",
          "Does this message mention a deadline?", None, False),
]

Predict = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]


def request_for(c: Check) -> dict[str, Any]:
    q: dict[str, Any] = {"type": c.kind.value, "instructions": c.instructions}
    if c.criteria is not None:
        q["criteria"] = c.criteria
    return {"state": c.state, "questions": {"q": q}}


def _sums_to_one(probs: dict[str, float]) -> bool:
    return bool(probs) and all(p >= 0 for p in probs.values()) and math.isclose(sum(probs.values()), 1.0, abs_tol=1e-3)


def judge(c: Check, resp: dict[str, Any]) -> dict[str, Any]:
    """Score one response. Never raises: malformed responses give wiring=False."""
    out: dict[str, Any] = {"id": c.id, "kind": c.kind.value, "expected": c.expected, "wiring": False, "correct": False, "got": None}
    try:
        a = resp["answers"]["q"]
        if a["type"] != c.kind.value:
            return out
        if c.kind == Primitive.CHOICE:
            assert c.criteria is not None
            probs = a["probabilities"]
            out["wiring"] = set(probs) == set(c.criteria) and _sums_to_one(probs) and a["choice"] == max(probs, key=probs.get)
            out["got"], out["probabilities"] = a["choice"], probs
            out["correct"] = a["choice"] == c.expected
        elif c.kind == Primitive.SCORE:
            assert c.criteria is not None
            probs = a["probabilities"]
            out["wiring"] = len(probs) == len(c.criteria) and _sums_to_one(probs) and 0 <= a["score"] <= len(c.criteria) - 1
            top = int(max(probs, key=probs.get))
            out["got"], out["probabilities"] = top, probs
            out["correct"] = top == c.expected
        else:
            p = a["noul"]
            out["wiring"] = isinstance(p, float | int) and 0.0 <= p <= 1.0
            out["got"], out["probabilities"] = p, {"true": p, "false": 1 - p}
            out["correct"] = (p > 0.5) == c.expected
    except (KeyError, TypeError, ValueError):
        out["wiring"] = False
    return out


async def run_checks(predict: Predict) -> dict[str, Any]:
    """Run all checks through `predict(request_body) -> response` and summarise."""
    results = [judge(c, await predict(request_for(c))) for c in CHECKS]
    return {"total": len(results), "wiring_ok": sum(r["wiring"] for r in results), "correct": sum(r["correct"] for r in results),
            "passed": all(r["wiring"] for r in results), "results": results}
