"""Delivery receipts: build, sign, send to the gateway, retry, and track the tasks."""

import asyncio
import hashlib
import hmac
import json
import logging
import random
from collections.abc import Coroutine, Sequence
from dataclasses import dataclass
from typing import Any

import httpx

from mock_carrier.clock import utc_now_iso
from mock_carrier.config import CarrierConfig
from mock_carrier.stats import CarrierStats

logger = logging.getLogger(__name__)

STATUSES = ("DELIVRD", "UNDELIV", "EXPIRED")
# Waits before the 2nd, 3rd and 4th attempt. One DLR is tried at most four times.
RETRY_BACKOFF_SECONDS = (0.2, 0.5, 1.0)
# How long after the first copy a duplicate DLR goes out.
DUPLICATE_GAP_MS = (50, 500)


def sign(secret: bytes, body: bytes) -> str:
    return hmac.new(secret, body, hashlib.sha256).hexdigest()


@dataclass(frozen=True)
class _Plan:
    status: str
    duplicate_gap_seconds: float | None


class DlrSender:
    def __init__(
        self,
        client: httpx.AsyncClient,
        config: CarrierConfig,
        stats: CarrierStats,
        rng: random.Random,
        retry_backoff_seconds: Sequence[float] = RETRY_BACKOFF_SECONDS,
    ) -> None:
        self._client = client
        self._config = config
        self._stats = stats
        self._rng = rng
        self._retry_backoff_seconds = retry_backoff_seconds
        self._url = f"{config.gateway_url}/carrier/dlr"
        self._secret = config.dlr_secret.encode()
        # asyncio keeps only weak references to tasks. Without this set a pending
        # DLR could be garbage collected before it is sent.
        self._tasks: set[asyncio.Task[None]] = set()

    def schedule(self, carrier_id: str) -> None:
        """Send the DLR in the background, after a delay from the configured range."""
        delay_ms = self._rng.uniform(self._config.dlr_min_delay_ms, self._config.dlr_max_delay_ms)
        self._spawn(self._send(carrier_id, self._plan(), delay_seconds=delay_ms / 1000))

    async def send_now(self, carrier_id: str) -> None:
        """Send the DLR and return once the gateway has answered it (the early case)."""
        await self._send(carrier_id, self._plan(), delay_seconds=0)

    async def aclose(self) -> None:
        """Cancel every DLR that has not gone out yet."""
        tasks = list(self._tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    def _plan(self) -> _Plan:
        # Every random choice is made at acceptance, in request order, so a seeded
        # run does not depend on which DLR timer happens to fire first.
        config = self._config
        weights = (config.p_delivrd, config.p_undeliv, config.p_expired)
        status = self._rng.choices(STATUSES, weights=weights)[0]
        duplicated = self._rng.random() < config.p_dlr_duplicate
        gap = self._rng.uniform(*DUPLICATE_GAP_MS) / 1000 if duplicated else None
        return _Plan(status=status, duplicate_gap_seconds=gap)

    def _spawn(self, work: Coroutine[Any, Any, None]) -> None:
        task = asyncio.create_task(work)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _send(self, carrier_id: str, plan: _Plan, delay_seconds: float) -> None:
        await asyncio.sleep(delay_seconds)
        # Serialised once. The signature covers these exact bytes, and a duplicate
        # reuses them, so both copies are byte-identical.
        body = json.dumps(
            {"carrier_id": carrier_id, "status": plan.status, "timestamp": utc_now_iso()},
            separators=(",", ":"),
        ).encode()
        await self._deliver(body)
        if plan.duplicate_gap_seconds is not None:
            self._spawn(self._deliver_after(plan.duplicate_gap_seconds, body))

    async def _deliver_after(self, delay_seconds: float, body: bytes) -> None:
        await asyncio.sleep(delay_seconds)
        await self._deliver(body)

    async def _deliver(self, body: bytes) -> None:
        headers = {"Content-Type": "application/json", "X-Signature": sign(self._secret, body)}
        status = await self._post(body, headers)
        for backoff in self._retry_backoff_seconds:
            if status is not None and status < 500:
                break
            await asyncio.sleep(backoff)
            status = await self._post(body, headers)

        if status is not None and 200 <= status < 300:
            self._stats.dlrs_sent += 1
        else:
            self._stats.dlrs_failed += 1
            logger.warning("DLR not delivered to %s (last answer: %s)", self._url, status or "none")

    async def _post(self, body: bytes, headers: dict[str, str]) -> int | None:
        """One attempt. Returns the HTTP status, or None when the gateway gave no answer."""
        try:
            response = await self._client.post(self._url, content=body, headers=headers)
        except httpx.TransportError:
            return None
        return response.status_code
