"""Remote backend: forwards System One requests to a hosted, TypeSafe-shaped endpoint (`POST /v1/systemone`).

Opt-in and metered: a hard USD cap (estimated from the input tokens the endpoint reports) stops requests once reached.
The API key is read from an environment variable at call time and is never stored, logged or echoed in errors.
Responses are only relayed to the caller (bench pages, tests); they are not saved as data.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import urllib.error
import urllib.request
from typing import Any

logger = logging.getLogger("decida.remote")

DEFAULT_KEY_ENV = "TYPESAFE_API_KEY"
DEFAULT_PRICE_PER_M_INPUT = 0.042  # USD per million input tokens; from a third-party README, verify against your invoice


class RemoteError(Exception):
    """A hosted endpoint refused or failed; `status` is the HTTP status to relay."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


class RemoteEngine:
    family = "remote"

    def __init__(self, url: str, remote_model: str, key_env: str = DEFAULT_KEY_ENV, budget_usd: float = 1.0,
                 price_per_m_input: float = DEFAULT_PRICE_PER_M_INPUT, timeout: float = 30.0):
        self.url, self.remote_model, self.key_env = url, remote_model, key_env
        self.budget_usd, self.price_per_m_input, self.timeout = budget_usd, price_per_m_input, timeout
        self.spent_usd = 0.0
        self.input_tokens = 0
        self.requests = 0
        self._queue: list = []  # api.py reads queue depth from every engine

    def _scrub(self, text: str, key: str) -> str:
        return text.replace(key, "<redacted>") if key else text

    def _post(self, body: bytes, key: str) -> dict[str, Any]:
        req = urllib.request.Request(self.url, data=body, method="POST",
                                     headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            detail = self._scrub(e.read().decode("utf-8", "replace")[:300], key)
            raise RemoteError(f"remote returned HTTP {e.code}: {detail}", e.code if e.code in (400, 401, 402, 403, 404, 422, 429) else 502) from None
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            raise RemoteError(f"remote request failed: {self._scrub(str(e), key)}", 502) from None

    async def predict_async(self, req) -> dict[str, Any]:
        if self.spent_usd >= self.budget_usd:
            raise RemoteError(f"remote budget of ${self.budget_usd:.2f} reached (spent about ${self.spent_usd:.4f} over {self.requests} requests); "
                              "restart with a higher --remote-budget-usd to continue", 402)
        key = os.environ.get(self.key_env, "")
        if not key:
            raise RemoteError(f"{self.key_env} is not set in the server's environment", 401)
        body = json.dumps({"model": self.remote_model, "state": req.state, "questions": req.questions}).encode()
        resp = await asyncio.to_thread(self._post, body, key)
        tokens = int((resp.get("usage") or {}).get("input_tokens", 0))
        self.requests += 1
        self.input_tokens += tokens
        self.spent_usd += tokens * self.price_per_m_input / 1e6
        resp["model"] = req.model
        resp.setdefault("x_decida", {}).update(remote=True, remote_model=self.remote_model, spent_usd=round(self.spent_usd, 6),
                                               budget_usd=self.budget_usd)
        logger.info("remote %s: %d tokens, spent $%.4f of $%.2f", self.remote_model, tokens, self.spent_usd, self.budget_usd)
        return resp
