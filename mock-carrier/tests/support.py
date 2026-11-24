"""Shared test helpers: a quiet baseline config and a fake gateway."""

import asyncio
from collections import deque
from collections.abc import Awaitable, Callable

import httpx

from mock_carrier.config import CarrierConfig

SECRET = "test-dlr-secret"

# The start_carrier fixture: keyword arguments override QUIET, the result is a client for the carrier.
StartCarrier = Callable[..., Awaitable[httpx.AsyncClient]]

# No latency, no failures, no DLR delay: each test switches on the one behaviour it is about.
QUIET = CarrierConfig(
    gateway_url="http://gateway.test",
    dlr_secret=SECRET,
    min_latency_ms=0,
    max_latency_ms=0,
    rate_limit_per_sec=1000,
    p_temporary_failure=0.0,
    p_permanent_failure=0.0,
    p_timeout=0.0,
    timeout_seconds=0.05,
    dlr_min_delay_ms=0,
    dlr_max_delay_ms=0,
    p_delivrd=1.0,
    p_undeliv=0.0,
    p_expired=0.0,
    p_dlr_duplicate=0.0,
    p_dlr_early=0.0,
    idempotent_submit=False,
    random_seed=1,
)


def message(message_id: str = "m-1") -> dict[str, str]:
    return {
        "message_id": message_id,
        "to": "+8801711000001",
        "from": "ACME",
        "text": "hello",
        "encoding": "GSM7",
    }


class FakeGateway:
    """Stands in for POST {GATEWAY_URL}/carrier/dlr and records every request.

    Answers the queued `statuses` in order, then 200. Set `unreachable` to make
    every call fail to connect, or `answer_delay_seconds` to answer slowly.
    """

    def __init__(self) -> None:
        self.statuses: deque[int] = deque()
        self.unreachable = False
        self.answer_delay_seconds = 0.0
        self.requests: list[httpx.Request] = []
        # Tests append their own marks here to check what happened first.
        self.events: list[str] = []
        self._handled = 0
        self._changed = asyncio.Condition()

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        try:
            if self.unreachable:
                raise httpx.ConnectError("gateway is down", request=request)
            await asyncio.sleep(self.answer_delay_seconds)
            self.events.append("dlr answered")
            status = self.statuses.popleft() if self.statuses else 200
            return httpx.Response(status, json={"result": "applied"})
        finally:
            self._handled += 1
            async with self._changed:
                self._changed.notify_all()

    @property
    def bodies(self) -> list[bytes]:
        return [request.content for request in self.requests]

    async def wait_for_requests(self, count: int, timeout_seconds: float = 2.0) -> None:
        """Wait until the gateway has finished handling `count` requests."""
        async with asyncio.timeout(timeout_seconds), self._changed:
            await self._changed.wait_for(lambda: self._handled >= count)
