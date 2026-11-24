"""The dispatcher: take messages from the queue, submit them to the carrier,
record what happened.

The queue is the `messages` table (status QUEUED, visible when
`next_attempt_at <= now()`). The order of operations is what makes it safe:

  1. claim ONE message and write the attempt row   (one SQL statement, committed)
  2. take a rate-limit token                       (Valkey, shared by all workers)
  3. call the carrier, at once
  4. record the result                             (one transaction)

A worker can die between any two steps. After step 1 the message is
invisible only until its lease runs out, then another worker claims it and
sees an attempt row with no outcome: evidence that the carrier may already
have the message. Nothing is lost; the open question is duplicates, and
DESIGN.md is explicit about where that risk remains.

Why the token comes right before the HTTP call: the carrier counts submits
when they ARRIVE. Anything that sits between "token granted" and "request
sent" (a slow query, a busy event loop) delays some submits more than
others and can squeeze more than 50 arrivals into one second even though
the tokens were handed out correctly. So nothing sits between them.

Why so little is claimed ahead: fairness. Each of a worker's lanes (two by
default) holds at most one message that is waiting for a token, so a late
OTP is a few slots behind, never behind a batch a worker took in advance.

Why more than one lane: a claim is a committed write, and on a busy
database it can take longer than the pacing interval. With a single
claim -> token -> send loop the worker then misses slots it was entitled
to. The first full run in Docker showed exactly that (41 submits/s against
a target of 46). A second lane claims the next message while the first
waits for its token.
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
from gateway.status import FAILED, SUBMITTED

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
#   The LATERAL ... LIMIT 1 is one probe into messages_dispatch_idx per
#   tenant: it stops at the tenant's first ready entry, so its cost does not
#   grow with the size of a backlog.
# picked: that tenant's oldest ready message (the ID is a UUIDv7, so ORDER BY
#   id is creation order). A retried message is older than the backlog behind
#   it, so it goes out first once its backoff has passed. SKIP LOCKED again,
#   so workers never wait on each other's rows.
#
# Both read messages through `tenant_id >= X AND tenant_id <= X ... ORDER BY
# tenant_id, id`. It looks redundant next to `tenant_id = X ORDER BY id`, and
# it is on purpose: with the equality the planner may walk messages_pkey in id
# order and filter every row of other tenants and every sent message, or hash
# the whole queue. Only messages_dispatch_idx can supply this order, so the
# plan stays an index scan that stops at the first ready row.
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
    CROSS JOIN LATERAL (
        SELECT 1
        FROM messages m
        WHERE m.tenant_id >= c.tenant_id AND m.tenant_id <= c.tenant_id
          AND m.status = 'QUEUED'
          AND m.next_attempt_at <= now()
        ORDER BY m.tenant_id, m.id
        LIMIT 1
    ) ready
    ORDER BY c.last_served_at
    LIMIT 1
    FOR UPDATE OF c SKIP LOCKED
),
picked AS (
    SELECT m.id
    FROM messages m
    WHERE m.tenant_id >= (SELECT tenant_id FROM next_tenant)
      AND m.tenant_id <= (SELECT tenant_id FROM next_tenant)
      AND m.status = 'QUEUED'
      AND m.next_attempt_at <= now()
    ORDER BY m.tenant_id, m.id
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


async def release_claim(pool: asyncpg.Pool, msg: Claimed, worker_id: str) -> None:
    """Undo a claim whose submit was never sent: no attempt happened.

    The attempt number alone is not a safe fence, because a release lowers
    it: after another worker claims and releases, the same number comes back.
    What proves that nobody claimed since is this worker's own attempt row
    still being open, because every re-claim closes it.
    """
    async with pool.acquire() as conn, conn.transaction():
        released = await conn.fetchval(
            """
            UPDATE messages m
            SET attempts = attempts - 1, next_attempt_at = now(), locked_by = NULL
            WHERE m.id = $1 AND m.status = 'QUEUED' AND m.attempts = $2
              AND EXISTS (
                  SELECT 1 FROM submit_attempts a
                  WHERE a.message_id = m.id AND a.attempt_no = $2
                    AND a.outcome IS NULL AND a.worker_id = $3)
            RETURNING true
            """,
            msg.id,
            msg.attempt,
            worker_id,
        )
        if released:
            await _delete_open_attempt(conn, msg)


async def _delete_open_attempt(conn: asyncpg.Connection, msg: Claimed) -> None:
    """Remove the write-ahead row of an attempt that was never sent."""
    await conn.execute(
        "DELETE FROM submit_attempts WHERE message_id = $1 AND attempt_no = $2 AND outcome IS NULL",
        msg.id,
        msg.attempt,
    )


async def _lock_message(conn: asyncpg.Connection, msg: Claimed) -> None:
    """Take the message row lock before touching its attempt rows.

    Lock order everywhere is: carrier_id advisory lock, then the message row,
    then its attempt rows. The claim statement locks the message and then
    closes an old attempt; without the same order here, a worker recording a
    late result and a worker re-claiming the same message could deadlock.
    """
    await conn.execute("SELECT 1 FROM messages WHERE id = $1 FOR UPDATE", msg.id)


async def _close_attempt(
    conn: asyncpg.Connection, msg: Claimed, result: SubmitResult, carrier_id: str | None = None
) -> bool:
    """Record the outcome on the attempt row. Return True if the row was still open.

    A carrier_id already on the row is kept: a repeated call must not erase
    the ID that DLRs are matched by.
    """
    was_open = await conn.fetchval(
        """
        WITH before AS (
            SELECT id, outcome FROM submit_attempts WHERE message_id = $1 AND attempt_no = $2
        )
        UPDATE submit_attempts a
        SET outcome = $3, finished_at = clock_timestamp(), http_status = $4,
            carrier_id = COALESCE($5, a.carrier_id), error = $6
        FROM before
        WHERE a.id = before.id
        RETURNING before.outcome IS NULL
        """,
        msg.id,
        msg.attempt,
        result.outcome.value,
        result.http_status,
        carrier_id,
        result.error,
    )
    return bool(was_open)


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
        await _lock_message(conn, msg)

        owner = await conn.fetchrow(
            "SELECT message_id, attempt_no FROM submit_attempts WHERE carrier_id = $1", carrier_id
        )
        owner_message = owner["message_id"] if owner is not None else None
        if owner_message is not None and owner_message != msg.id:
            # A carrier_id must identify one message. If the carrier reuses
            # one, we cannot route its DLR; do not guess.
            log.error(
                "carrier_id %s already belongs to message %s, not %s", carrier_id, owner_message, msg.id
            )
        # carrier_id is unique across attempts. An idempotent carrier returns
        # the same ID for a retried message: it stays on the attempt that has it.
        mine = owner is not None and owner_message == msg.id and owner["attempt_no"] == msg.attempt
        await _close_attempt(conn, msg, result, carrier_id if owner is None or mine else None)

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
        else:
            await _report_late_acceptance(conn, msg, carrier_id)
        if owner_message is None or owner_message == msg.id:
            changes.extend(await apply_pending(conn, carrier_id))
        return changes


async def _report_late_acceptance(conn: asyncpg.Connection, msg: Claimed, carrier_id: str) -> None:
    """A worker that outlived its lease can learn of an acceptance after another
    attempt failed the message and refunded it. Money and status stay as they
    are (FAILED is final and the tenant has its webhook); the case is made loud."""
    status = await conn.fetchval("SELECT status FROM messages WHERE id = $1", msg.id)
    if status != FAILED:
        return
    metrics.ACCEPTED_AFTER_FAILED.inc()
    log.error(
        "carrier accepted attempt %d of message %s (carrier_id %s) after it was failed and refunded",
        msg.attempt,
        msg.id,
        carrier_id,
    )


async def record_retry(pool: asyncpg.Pool, msg: Claimed, result: SubmitResult, decision: Decision) -> None:
    """Not accepted, or unknown: make the message visible again after the backoff."""
    async with pool.acquire() as conn, conn.transaction():
        await _lock_message(conn, msg)
        # Count an ambiguous attempt only once, also when this call is repeated.
        was_open = await _close_attempt(conn, msg, result)
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
            1 if decision.ambiguous and was_open else 0,
        )


async def record_failed(
    pool: asyncpg.Pool, msg: Claimed, result: SubmitResult | None, decision: Decision
) -> list[StatusChange]:
    """Permanent error or no attempts left: QUEUED -> FAILED with a refund."""
    async with pool.acquire() as conn, conn.transaction():
        await _lock_message(conn, msg)
        # Without a result nothing was sent, and the claim's attempt is undone
        # below: the event names the last attempt that was made.
        detail: dict[str, Any] = {"attempt": msg.attempt if result is not None else msg.attempt - 1}
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
        if change is not None and result is None:
            change = await _undo_unsent_attempt(conn, msg, change)
        return [change] if change else []


async def _undo_unsent_attempt(conn: asyncpg.Connection, msg: Claimed, change: StatusChange) -> StatusChange:
    """The claim counted an attempt and wrote its row, but nothing was sent.

    Without this the row would stay open for ever (a FAILED message is never
    claimed again), showing a submit in flight that never existed. Runs after
    the fenced failure, which needs the counter as the claim left it.
    """
    await _delete_open_attempt(conn, msg)
    row = await conn.fetchrow(
        """
        UPDATE messages m SET attempts = m.attempts - 1
        FROM tenants t
        WHERE m.id = $1 AND t.id = m.tenant_id
        RETURNING m.*, t.name AS tenant_name, t.currency
        """,
        msg.id,
    )
    return StatusChange(message=row, occurred_at=change.occurred_at)


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
            "dispatcher %s started: target %.1f submits/s (carrier limit %d), burst %d, "
            "%d lanes, max in flight %d",
            self.worker_id,
            self._settings.carrier_target_rate,
            self._settings.carrier_rate_limit,
            self._settings.carrier_burst,
            self._settings.worker_lanes,
            self._settings.worker_max_in_flight,
        )
        lanes = [
            asyncio.create_task(self._lane(stop), name=f"lane-{i}")
            for i in range(max(1, self._settings.worker_lanes))
        ]
        await asyncio.gather(*lanes)
        await self._drain()

    async def _lane(self, stop: asyncio.Event) -> None:
        """One claim -> token -> send loop. Lanes share the in-flight cap and nothing else."""
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

    async def _tick(self) -> float:
        """Claim one message, wait for its token, start its submit. Return how long to pause."""
        in_flight = set(self._tasks)  # a copy: other lanes add and remove while we wait
        if len(in_flight) >= self._settings.worker_max_in_flight:
            await asyncio.wait(in_flight, return_when=asyncio.FIRST_COMPLETED)
            return 0.0

        msg = await claim_one(self._pool, self.worker_id, self._settings.lease_seconds)
        if msg is None:
            return self._settings.worker_idle_poll_seconds

        try:
            await self._wait_for_token()
        except BaseException:
            # No token (Valkey down, or we are shutting down): the message was
            # never sent, so undo the claim instead of leaving an open attempt
            # that would later be counted as "the carrier may have it".
            await asyncio.shield(release_claim(self._pool, msg, self.worker_id))
            raise
        self._spawn(msg)
        return 0.0

    async def _wait_for_token(self) -> None:
        """Block until the shared limiter grants one submit. Without a token nothing is sent."""
        while True:
            granted, wait = await self._limiter.acquire(1)
            if granted:
                return
            await asyncio.sleep(wait)

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
        """Claim and fully process one message, if one is ready. Used by the tests."""
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
            await self._penalize(settings.carrier_429_penalty_seconds)

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

    async def _penalize(self, seconds: float) -> None:
        """The carrier's count is the one that matters: slow every worker down.

        Best effort. The 429 itself is a known result and is recorded whether
        or not Valkey takes the penalty; otherwise a refused submit would wait
        out the lease and then be counted as one the carrier may have taken.
        """
        try:
            await self._limiter.penalize(seconds)
        except Exception:
            log.warning("could not apply the 429 penalty", exc_info=True)

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
