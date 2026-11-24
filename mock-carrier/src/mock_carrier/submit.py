"""What the carrier does with one submit: rate limit, pick an outcome, answer."""

import asyncio
import random
import time
import uuid
from enum import Enum, auto

from mock_carrier.config import CarrierConfig
from mock_carrier.dlr import DlrSender
from mock_carrier.rate_limit import SlidingWindow
from mock_carrier.stats import CarrierStats

Answer = tuple[int, dict[str, str]]


class _Outcome(Enum):
    TEMPORARY_FAILURE = auto()
    PERMANENT_FAILURE = auto()
    TIMEOUT = auto()
    ACCEPT = auto()


class SubmitHandler:
    """In-memory carrier state.

    Everything runs on one event loop and no method awaits between reading and
    writing shared state, so there are no locks.
    """

    def __init__(
        self, config: CarrierConfig, dlr: DlrSender, stats: CarrierStats, rng: random.Random
    ) -> None:
        self._config = config
        self._dlr = dlr
        self._stats = stats
        self._rng = rng
        self._window = SlidingWindow(config.rate_limit_per_sec)
        self._first_carrier_id: dict[str, str] = {}

    async def submit(self, message_id: str) -> Answer:
        config, stats = self._config, self._stats
        stats.record_submit()

        if not self._window.try_admit():
            stats.rate_limited += 1
            return 429, {"error": "RATE_LIMITED"}
        stats.max_submits_in_one_second = max(stats.max_submits_in_one_second, len(self._window))

        latency = self._rng.uniform(config.min_latency_ms, config.max_latency_ms) / 1000

        if config.idempotent_submit and message_id in self._first_carrier_id:
            await asyncio.sleep(latency)
            return 200, {"carrier_id": self._first_carrier_id[message_id]}

        outcome = self._draw_outcome()
        if outcome is _Outcome.TEMPORARY_FAILURE:
            stats.temporary_failures += 1
            await asyncio.sleep(latency)
            return 503, {"error": "TEMPORARY_FAILURE"}
        if outcome is _Outcome.PERMANENT_FAILURE:
            stats.permanent_failures += 1
            await asyncio.sleep(latency)
            return 400, {"error": "INVALID_DESTINATION"}

        # Accepted from here on, and recorded before the first await: a retry that
        # arrives while this request is still sleeping already sees the message.
        carrier_id = self._accept(message_id)

        if outcome is _Outcome.TIMEOUT:
            stats.timeouts += 1
            self._dlr.schedule(carrier_id)
            await asyncio.sleep(config.timeout_seconds)
            return 504, {"error": "TIMEOUT"}

        if self._rng.random() < config.p_dlr_early:
            started = time.monotonic()
            await self._dlr.send_now(carrier_id)
            latency -= time.monotonic() - started
        else:
            self._dlr.schedule(carrier_id)
        await asyncio.sleep(max(latency, 0.0))
        return 200, {"carrier_id": carrier_id}

    def reset(self) -> None:
        self._stats.reset()
        self._first_carrier_id.clear()

    def _draw_outcome(self) -> _Outcome:
        config = self._config
        draw = self._rng.random()
        if draw < config.p_temporary_failure:
            return _Outcome.TEMPORARY_FAILURE
        draw -= config.p_temporary_failure
        if draw < config.p_permanent_failure:
            return _Outcome.PERMANENT_FAILURE
        draw -= config.p_permanent_failure
        if draw < config.p_timeout:
            return _Outcome.TIMEOUT
        return _Outcome.ACCEPT

    def _accept(self, message_id: str) -> str:
        # Not drawn from the seeded generator: the gateway stores carrier IDs, so a
        # restart with the same RANDOM_SEED must not hand out the same IDs again.
        carrier_id = f"c-{uuid.uuid4().hex}"
        self._stats.accepted += 1
        if message_id in self._first_carrier_id:
            self._stats.duplicate_accepts += 1
        else:
            self._stats.unique_message_ids_accepted += 1
            self._first_carrier_id[message_id] = carrier_id
        return carrier_id
