"""The carrier HTTP client and the classification of what came back.

Everything the dispatcher needs to decide is in `Outcome`. The important
split is not "success / failure" but three-way:

  * we KNOW the carrier accepted            -> ACCEPTED
  * we KNOW the carrier did not accept      -> RATE_LIMITED, UNAVAILABLE, REJECTED
  * we DO NOT KNOW                          -> TIMEOUT

Only the last group can lead to a duplicate SMS when retried.
"""

from __future__ import annotations

import enum
import uuid
from dataclasses import dataclass
from typing import Any

import httpx


class Outcome(enum.StrEnum):
    ACCEPTED = "ACCEPTED"
    RATE_LIMITED = "RATE_LIMITED"
    UNAVAILABLE = "UNAVAILABLE"
    REJECTED = "REJECTED"
    TIMEOUT = "TIMEOUT"


@dataclass(frozen=True, slots=True)
class SubmitResult:
    outcome: Outcome
    http_status: int | None = None
    carrier_id: str | None = None
    error: str | None = None
    #: Seconds from a Retry-After header, if the carrier sent one.
    retry_after: float | None = None


@dataclass(frozen=True, slots=True)
class OutboundMessage:
    id: uuid.UUID
    to: str
    sender: str
    text: str
    encoding: str


class CarrierClient:
    def __init__(
        self,
        base_url: str,
        *,
        timeout_seconds: float,
        max_connections: int = 64,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            timeout=httpx.Timeout(timeout_seconds, connect=min(timeout_seconds, 2.0)),
            limits=httpx.Limits(max_connections=max_connections, max_keepalive_connections=max_connections),
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def submit(self, message: OutboundMessage) -> SubmitResult:
        payload = {
            # The same ID on every attempt. A carrier that de-duplicates on it
            # turns our at-least-once retry into exactly-once delivery.
            "message_id": str(message.id),
            "to": message.to,
            "from": message.sender,
            "text": message.text,
            "encoding": message.encoding,
        }
        try:
            response = await self._client.post("/submit", json=payload)
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout) as exc:
            # The request never left: no connection was made. Safe to retry.
            return SubmitResult(Outcome.UNAVAILABLE, error=f"{type(exc).__name__}: no connection")
        except httpx.TimeoutException as exc:
            # Sent, no answer in time. The carrier may or may not have it.
            return SubmitResult(Outcome.TIMEOUT, error=f"{type(exc).__name__}: no response in time")
        except httpx.TransportError as exc:
            # Connection broke after the request went out. Same uncertainty.
            return SubmitResult(Outcome.TIMEOUT, error=f"{type(exc).__name__}: connection lost")
        return classify(response)


def classify(response: httpx.Response) -> SubmitResult:
    status = response.status_code
    body = _json(response)
    error = body.get("error") if isinstance(body.get("error"), str) else None

    if status == 200:
        carrier_id = body.get("carrier_id")
        if isinstance(carrier_id, str) and carrier_id:
            return SubmitResult(Outcome.ACCEPTED, status, carrier_id=carrier_id)
        # Accepted, but we cannot match its DLR without an ID. Treat as unknown.
        return SubmitResult(Outcome.TIMEOUT, status, error="200 without a carrier_id")
    if status == 429:
        return SubmitResult(Outcome.RATE_LIMITED, status, error=error, retry_after=_retry_after(response))
    if status == 503:
        return SubmitResult(Outcome.UNAVAILABLE, status, error=error, retry_after=_retry_after(response))
    if status == 408 or status >= 500:
        # A 500/502/504 does not say whether the message was taken before the
        # failure. Retrying is right, but it is an ambiguous attempt.
        return SubmitResult(Outcome.TIMEOUT, status, error=error or f"HTTP {status}")
    if 400 <= status < 500:
        return SubmitResult(Outcome.REJECTED, status, error=error or f"HTTP {status}")
    return SubmitResult(Outcome.TIMEOUT, status, error=f"unexpected HTTP {status}")


def _json(response: httpx.Response) -> dict[str, Any]:
    try:
        data = response.json()
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def _retry_after(response: httpx.Response) -> float | None:
    value = response.headers.get("retry-after")
    if value is None:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        return None
