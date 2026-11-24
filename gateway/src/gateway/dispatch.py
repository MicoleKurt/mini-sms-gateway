"""The dispatcher: take messages from the queue, submit them to the carrier,
record what happened.

The queue is the `messages` table (status QUEUED, visible when
`next_attempt_at <= now()`). The order of operations is what makes it safe:

  1. take a rate-limit token                       (Redis, shared by all workers)
  2. claim ONE message and write the attempt row   (one SQL statement, committed)
  3. call the carrier
  4. record the result                             (one transaction)

A worker can die between any two steps. After step 2 the message is
invisible only until its lease runs out, then another worker claims it and
sees an attempt row with no outcome: evidence that the carrier may already
have the message. Nothing is lost; the open question is duplicates, and
DESIGN.md is explicit about where that risk remains.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import random
import time
import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

import asyncpg

from gateway import metrics
from gateway.carrier import CarrierClient, OutboundMessage, Outcome, SubmitResult
from gateway.config import Settings
from gateway.dlr import apply_pending, lock_carrier_id
from gateway.lifecycle import fail_message
from gateway.limiter import RateLimiter
from gateway.live import LivePublisher
from gateway.messages import StatusChange, transition
from gateway.retry import Action, Decision, decide
from gateway.status import SUBMITTED

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class Claimed:
    id: uuid.UUID
    tenant_id: uuid.UUID
    to: str
    sender: str
    text: str
    encoding: str
    #: 1 for the first attempt. Also the fencing token of this claim.
    attempt: int


# Fair claim, one message per call.
#
# next_tenant: among tenants that have a message ready, the one served
#   longest ago (round robin). SKIP LOCKED lets two workers pick two
#   different tenants at the same moment instead of queueing on one row.
# picked: that tenant's oldest ready message. SKIP LOCKED again, so workers
#   never wait on each other's rows.
# closed: an earlier attempt for this message that never got an outcome
#   means its worker died or stalled past the lease. Mark it ABANDONED and
#   count it as ambiguous: the carrier may have received that submit.
# claimed: bump the attempt counter and push next_attempt_at forward by the
#   lease. That is the whole lock: the message is invisible to other claims
#   until the lease ends, and becomes visible again by itself if we die.
# started: the write-ahead record of the attempt, committed before the HTTP call.
_CLAIM = """
WITH next_tenant AS (
    SELECT c.tenant_id
    FROM dispatch_cursor c
    WHERE EXISTS (
        SELECT 1 FROM messages m
        WHERE m.tenant_id = c.tenant_id
          AND m.status = 'QUEUED'
          AND m.next_attempt_at <= now())
    ORDER BY c.last_served_at
    LIMIT 1
    FOR UPDATE OF c SKIP LOCKED
),
picked AS (
    SELECT m.id
    FROM messages m
    WHERE m.tenant_id = (SELECT tenant_id FROM next_tenant)
      AND m.status = 'QUEUED'
      AND m.next_attempt_at <= now()
    ORDER BY m.next_attempt_at, m.id
    LIMIT 1
    FOR UPDATE OF m SKIP LOCKED
),
served AS (
    UPDATE dispatch_cursor
    SET last_served_at = clock_timestamp()
    WHERE tenant_id = (SELECT tenant_id FROM next_tenant)
),
closed AS (
    UPDATE submit_attempts a
    SET outcome = 'ABANDONED',
        finished_at = clock_timestamp(),
        error = 'lease expired before a result was recorded'
    FROM picked p
    WHERE a.message_id = p.id AND a.outcome IS NULL
    RETURNING a.id
),
claimed AS (
    UPDATE messages m
    SET attempts = m.attempts + 1,
        ambiguous_attempts = m.ambiguous_attempts + (SELECT count(*) FROM closed),
        next_attempt_at = now() + $2::interval,
        locked_by = $1
    FROM picked p
    WHERE m.id = p.id
    RETURNING m.id, m.tenant_id, m.to_number, m.sender_id, m.body, m.encoding, m.attempts
),
started AS (
    INSERT INTO submit_attempts (message_id, attempt_no, worker_id)
    SELECT id, attempts, $1 FROM claimed
)
SELECT * FROM claimed
"""


async def claim_one(pool: asyncpg.Pool, worker_id: str, lease_seconds: float) -> Claimed | None:
    row = await pool.fetchrow(_CLAIM, worker_id, timedelta(seconds=lease_seconds))
    if row is None:
        return None
    return Claimed(
        id=row["id"],
        tenant_id=row["tenant_id"],
        to=row["to_number"],
        sender=row["sender_id"],
        text=row["body"],
        encoding=row["encoding"],
        attempt=row["attempts"],
    )


async def _close_attempt(
    conn: asyncpg.Connection, msg: Claimed, result: SubmitResult, carrier_id: str | None = None
) -> None:
    await conn.execute(
        """
        UPDATE submit_attempts
        SET outcome = $3, finished_at = clock_timestamp(), http_status = $4, carrier_id = $5, error = $6
        WHERE message_id = $1 AND attempt_no = $2
        """,
        msg.id,
        msg.attempt,
        result.outcome.value,
        result.http_status,
        carrier_id,
        result.error,
    )


async def record_accepted(pool: asyncpg.Pool, msg: Claimed, result: SubmitResult) -> list[StatusChange]:
    """The carrier returned a carrier_id: QUEUED -> SUBMITTED, then any early DLR.

    Not fenced by attempt number on purpose. If our lease expired and another
    worker is retrying, the fact that the carrier accepted THIS attempt is
    still true and still the most useful thing to record.
    """
    carrier_id = result.carrier_id
    assert carrier_id is not None
    async with pool.acquire() as conn, conn.transaction():
        # Same lock as the DLR endpoint. See gateway.dlr for why.
        await lock_carrier_id(conn, carrier_id)

        owner = await conn.fetchval(
            "SELECT message_id FROM submit_attempts WHERE carrier_id = $1", carrier_id
        )
        if owner is not None and owner != msg.id:
            # A carrier_id must identify one message. If the carrier reuses
            # one, we cannot route its DLR; do not guess.
            log.error("carrier_id %s already belongs to message %s, not %s", carrier_id, owner, msg.id)
        # carrier_id is unique across attempts. An idempotent carrier returns
        # the same ID for a retried message: keep it on the first attempt only.
        await _close_attempt(conn, msg, result, carrier_id if owner is None else None)

        changes: list[StatusChange] = []
        change = await transition(
            conn,
            msg.id,
            SUBMITTED,
            detail={"carrier_id": carrier_id, "attempt": msg.attempt},
            carrier_id=carrier_id,
        )
        if change is not None:
            changes.append(change)
        if owner is None or owner == msg.id:
            changes.extend(await apply_pending(conn, carrier_id))
        return changes


async def record_retry(pool: asyncpg.Pool, msg: Claimed, result: SubmitResult, decision: Decision) -> None:
    """Not accepted, or unknown: make the message visible again after the backoff."""
    async with pool.acquire() as conn, conn.transaction():
        await _close_attempt(conn, msg, result)
        await conn.execute(
            """
            UPDATE messages
            SET next_attempt_at = now() + $3::interval,
                locked_by = NULL,
                ambiguous_attempts = ambiguous_attempts + $4
            WHERE id = $1 AND status = 'QUEUED' AND attempts = $2
            """,
            msg.id,
            msg.attempt,
            timedelta(seconds=decision.delay_seconds),
            1 if decision.ambiguous else 0,
        )


async def record_failed(
    pool: asyncpg.Pool, msg: Claimed, result: SubmitResult | None, decision: Decision
) -> list[StatusChange]:
    """Permanent error or no attempts left: QUEUED -> FAILED with a refund."""
    async with pool.acquire() as conn, conn.transaction():
        detail: dict[str, Any] = {"attempt": msg.attempt}
        if result is not None:
            await _close_attempt(conn, msg, result)
            detail["http_status"] = result.http_status
            detail["carrier_error"] = result.error
        if decision.ambiguous:
            await conn.execute(
                "UPDATE messages SET ambiguous_attempts = ambiguous_attempts + 1 "
                "WHERE id = $1 AND status = 'QUEUED' AND attempts = $2",
                msg.id,
                msg.attempt,
            )
        change = await fail_message(
            conn,
            msg.id,
            reason=decision.reason or "FAILED",
            detail=detail,
            fence_attempt=msg.attempt,
        )
        return [change] if change else []


class Dispatcher:
    def __init__(
        self,
        *,
        pool: asyncpg.Pool,
        limiter: RateLimiter,
        carrier: CarrierClient,
        publisher: LivePublisher,
        settings: Settings,
        worker_id: str | None = None,
        rng: random.Random | None = None,
    ) -> None:
        self._pool = pool
        self._limiter = limiter
        self._carrier = carrier
        self._publisher = publisher
        self._settings = settings
        self._rng = rng
        self.worker_id = worker_id or f"w-{uuid.uuid4().hex[:8]}"
        self._tasks: set[asyncio.Task[None]] = set()

    # -- loop ---------------------------------------------------------------

    async def run(self, stop: asyncio.Event) -> None:
        log.info(
            "dispatcher %s started: target %.1f submits/s (carrier limit %d), burst %d, max in flight %d",
            self.worker_id,
            self._settings.carrier_target_rate,
            self._settings.carrier_rate_limit,
            self._settings.carrier_burst,
            self._settings.worker_max_in_flight,
        )
        while not stop.is_set():
            try:
                pause = await self._tick()
            except Exception:
                # Database or Redis trouble. Messages stay QUEUED; try again soon.
                log.exception("dispatcher tick failed")
                pause = 1.0
            if pause > 0:
                with contextlib.suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(stop.wait(), timeout=pause)
        await self._drain()

    async def _tick(self) -> float:
        """Start as many submits as tokens allow. Return how long to pause."""
        free = self._settings.worker_max_in_flight - len(self._tasks)
        if free <= 0:
            await asyncio.wait(self._tasks, return_when=asyncio.FIRST_COMPLETED)
            return 0.0

        # Token first, claim second. A message is chosen only when it can be
        # sent right now, so the fair pick is made at the last moment and a
        # late OTP is never stuck behind messages a worker claimed in advance.
        granted, wait = await self._limiter.acquire(min(free, self._limiter.burst))
        if granted == 0:
            return wait

        started = 0
        try:
            for _ in range(granted):
                msg = await claim_one(self._pool, self.worker_id, self._settings.lease_seconds)
                if msg is None:
                    break
                started += 1
                self._spawn(msg)
        finally:
            if started < granted:
                await self._limiter.release(granted - started)
        return 0.0 if started else self._settings.worker_idle_poll_seconds

    def _spawn(self, msg: Claimed) -> None:
        task = asyncio.create_task(self._handle_safely(msg), name=f"submit-{msg.id}")
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _drain(self) -> None:
        """On shutdown, let in-flight submits finish. What does not finish is
        recovered by lease expiry, like a crash."""
        if not self._tasks:
            return
        log.info("dispatcher %s draining %d in-flight submits", self.worker_id, len(self._tasks))
        _, pending = await asyncio.wait(self._tasks, timeout=self._settings.worker_shutdown_grace_seconds)
        for task in pending:
            task.cancel()

    async def run_once(self) -> int:
        """Claim and fully process whatever one tick allows. Used by the tests."""
        await self._tick()
        tasks = list(self._tasks)
        if tasks:
            await asyncio.gather(*tasks)
        return len(tasks)

    # -- one message ----------------------------------------------------------

    async def _handle_safely(self, msg: Claimed) -> None:
        try:
            await self.handle(msg)
        except Exception:
            # The attempt row stays open, the lease expires, the message is
            # claimed again and that attempt is counted as ambiguous.
            log.exception("submit of message %s (attempt %d) was not recorded", msg.id, msg.attempt)

    async def handle(self, msg: Claimed) -> None:
        settings = self._settings
        if msg.attempt > settings.max_attempts:
            # Only reachable when earlier attempts were abandoned (crash loop).
            decision = Decision(Action.FAIL, reason="MAX_ATTEMPTS_EXCEEDED")
            await self._publish(await self._with_retries(record_failed, msg, None, decision))
            return

        started = time.monotonic()
        result = await self._carrier.submit(
            OutboundMessage(id=msg.id, to=msg.to, sender=msg.sender, text=msg.text, encoding=msg.encoding)
        )
        metrics.SUBMIT_SECONDS.observe(time.monotonic() - started)
        metrics.SUBMIT_ATTEMPTS.labels(result.outcome.value).inc()

        if result.outcome is Outcome.RATE_LIMITED:
            # The carrier's count is the one that matters. Slow every worker down.
            await self._limiter.penalize(settings.carrier_429_penalty_seconds)

        decision = decide(
            result,
            attempt=msg.attempt,
            max_attempts=settings.max_attempts,
            base_seconds=settings.retry_base_seconds,
            max_seconds=settings.retry_max_seconds,
            rng=self._rng,
        )
        if decision.action is Action.DONE:
            changes = await self._with_retries(record_accepted, msg, result)
        elif decision.action is Action.RETRY:
            await self._with_retries(record_retry, msg, result, decision)
            changes = []
        else:
            changes = await self._with_retries(record_failed, msg, result, decision)
        await self._publish(changes)

    async def _with_retries(self, record: Any, *args: Any) -> Any:
        """Recording the result is worth a few tries: if we lose an ACCEPTED,
        the message is sent again after the lease. Every record function is
        idempotent, so repeating one is safe."""
        delay = 0.2
        for attempt in range(1, 4):
            try:
                return await record(self._pool, *args)
            except (asyncpg.PostgresError, OSError):
                if attempt == 3:
                    raise
                log.warning("recording a submit result failed, retrying", exc_info=True)
                await asyncio.sleep(delay)
                delay *= 2
        return None

    async def _publish(self, changes: list[StatusChange] | None) -> None:
        for change in changes or []:
            status = change.message["status"]
            if change.message["finalized_at"] is not None:
                metrics.MESSAGES_FINAL.labels(status).inc()
        await self._publisher.publish_changes(changes or [])
