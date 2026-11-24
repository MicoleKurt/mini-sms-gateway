"""Dispatch: retries, permanent failures, timeouts, crash recovery, fairness, the rate limit."""

from __future__ import annotations

import asyncio
import itertools
import time
from datetime import timedelta
from typing import Any

import asyncpg
import httpx
import pytest

from conftest import (
    ACME_ID,
    BD_PRICE,
    SHOPFAST_ID,
    FakeCarrier,
    assert_books_balance,
    balance_of,
    event_statuses,
    make_settings,
    message_row,
    send,
    sms,
)
from gateway.dispatch import claim_one
from gateway.limiter import RateLimiter


async def _attempts(pool: asyncpg.Pool, message_id: str) -> list[tuple[int, str | None]]:
    rows = await pool.fetch(
        "SELECT attempt_no, outcome FROM submit_attempts WHERE message_id = $1::uuid ORDER BY attempt_no",
        message_id,
    )
    return [(r["attempt_no"], r["outcome"]) for r in rows]


async def _expire_lease(pool: asyncpg.Pool, message_id: str) -> None:
    """What the passing of `lease_seconds` does: the message becomes visible again."""
    await pool.execute("UPDATE messages SET next_attempt_at = now() WHERE id = $1::uuid", message_id)


# --- retries ---------------------------------------------------------------------


async def test_503_and_429_are_retried_until_accepted(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict, carrier: FakeCarrier, make_dispatcher
) -> None:
    message_id = await send(client, acme)
    carrier.then(503, 429, 503, "c-ok")
    dispatcher = make_dispatcher()

    for _ in range(4):
        await dispatcher.run_once()

    row = await message_row(pool, message_id)
    assert (row["status"], row["attempts"], row["carrier_id"]) == ("SUBMITTED", 4, "c-ok")
    assert row["ambiguous_attempts"] == 0  # the carrier said no three times; nothing is uncertain
    assert await _attempts(pool, message_id) == [
        (1, "UNAVAILABLE"),
        (2, "RATE_LIMITED"),
        (3, "UNAVAILABLE"),
        (4, "ACCEPTED"),
    ]
    assert await event_statuses(pool, message_id) == ["ACCEPTED", "QUEUED", "SUBMITTED"]
    # Retries are free: still exactly one charge.
    assert await balance_of(pool, ACME_ID) == 250_000_000 - BD_PRICE


async def test_400_is_never_retried(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict, carrier: FakeCarrier, make_dispatcher
) -> None:
    message_id = await send(client, acme)
    carrier.then(400)
    dispatcher = make_dispatcher()

    await dispatcher.run_once()
    for _ in range(3):  # nothing left to do, however often the worker looks
        assert await dispatcher.run_once() == 0

    row = await message_row(pool, message_id)
    assert (row["status"], row["attempts"], row["failure_reason"]) == ("FAILED", 1, "INVALID_DESTINATION")
    assert len(carrier.requests) == 1
    assert await event_statuses(pool, message_id) == ["ACCEPTED", "QUEUED", "FAILED"]
    assert await balance_of(pool, ACME_ID) == 250_000_000  # refunded


async def test_retry_waits_for_the_backoff(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict, carrier: FakeCarrier, make_dispatcher
) -> None:
    message_id = await send(client, acme)
    carrier.then(503)
    dispatcher = make_dispatcher(make_settings(retry_base_seconds=30.0, retry_max_seconds=60.0))

    await dispatcher.run_once()

    row = await message_row(pool, message_id)
    wait = await pool.fetchval("SELECT EXTRACT(EPOCH FROM $1 - now())", row["next_attempt_at"])
    assert 14 <= wait <= 31  # between half and all of the 30 s base
    assert await dispatcher.run_once() == 0  # not visible yet
    assert len(carrier.requests) == 1


async def test_gives_up_after_max_attempts_and_refunds(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict, carrier: FakeCarrier, make_dispatcher
) -> None:
    message_id = await send(client, acme)
    carrier.then(503, 503, 503, 503)
    dispatcher = make_dispatcher(make_settings(max_attempts=3))

    for _ in range(5):
        await dispatcher.run_once()

    row = await message_row(pool, message_id)
    assert (row["status"], row["attempts"], row["failure_reason"]) == ("FAILED", 3, "MAX_ATTEMPTS_EXCEEDED")
    assert len(carrier.requests) == 3
    assert await balance_of(pool, ACME_ID) == 250_000_000
    await assert_books_balance(pool)


# --- timeouts and crashes ----------------------------------------------------------


async def test_timeout_is_retried_with_the_same_message_id_and_flagged(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict, carrier: FakeCarrier, make_dispatcher
) -> None:
    message_id = await send(client, acme)
    carrier.then("timeout", "c-second")
    dispatcher = make_dispatcher()

    await dispatcher.run_once()
    await dispatcher.run_once()

    row = await message_row(pool, message_id)
    assert (row["status"], row["attempts"]) == ("SUBMITTED", 2)
    # The carrier may have taken the first submit. The message says so.
    assert row["ambiguous_attempts"] == 1
    assert await _attempts(pool, message_id) == [(1, "TIMEOUT"), (2, "ACCEPTED")]
    # Both submits carry the same ID: a carrier that de-duplicates sends one SMS.
    assert [r["message_id"] for r in carrier.requests] == [message_id, message_id]


async def test_a_message_claimed_by_a_dead_worker_is_recovered(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict, carrier: FakeCarrier, make_dispatcher
) -> None:
    """Worker A claims the message and dies before it records anything."""
    message_id = await send(client, acme)

    claimed = await claim_one(pool, "w-dead", lease_seconds=30)
    assert claimed is not None and str(claimed.id) == message_id

    # While the lease runs, the message is invisible to every other worker.
    dispatcher = make_dispatcher()
    assert await dispatcher.run_once() == 0
    assert await _attempts(pool, message_id) == [(1, None)]  # the write-ahead attempt row

    await _expire_lease(pool, message_id)
    assert await dispatcher.run_once() == 1

    row = await message_row(pool, message_id)
    assert (row["status"], row["attempts"]) == ("SUBMITTED", 2)
    assert row["ambiguous_attempts"] == 1  # we cannot know whether w-dead reached the carrier
    assert await _attempts(pool, message_id) == [(1, "ABANDONED"), (2, "ACCEPTED")]


async def test_a_slow_worker_that_answers_after_its_lease_still_counts(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict, make_dispatcher
) -> None:
    """Worker A stalls past its lease, worker B retries and is refused by the
    carrier, then A's 200 arrives. The carrier DID accept A's submit, so the
    message is SUBMITTED, and B's late failure must not fail it."""
    from gateway.carrier import Outcome, SubmitResult
    from gateway.dispatch import record_accepted, record_retry
    from gateway.retry import Action, Decision

    message_id = await send(client, acme)
    slow = await claim_one(pool, "w-slow", lease_seconds=30)
    await _expire_lease(pool, message_id)
    retry = await claim_one(pool, "w-retry", lease_seconds=30)
    assert slow is not None and retry is not None and (slow.attempt, retry.attempt) == (1, 2)

    await record_accepted(pool, slow, SubmitResult(Outcome.ACCEPTED, 200, carrier_id="c-slow"))
    await record_retry(
        pool, retry, SubmitResult(Outcome.UNAVAILABLE, 503), Decision(Action.RETRY, delay_seconds=0)
    )

    row = await message_row(pool, message_id)
    assert (row["status"], row["carrier_id"]) == ("SUBMITTED", "c-slow")
    assert await make_dispatcher().run_once() == 0  # not re-queued


async def test_a_stale_worker_cannot_fail_a_message_that_was_reclaimed(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict
) -> None:
    from gateway.carrier import Outcome, SubmitResult
    from gateway.dispatch import record_failed
    from gateway.retry import Action, Decision

    message_id = await send(client, acme)
    stale = await claim_one(pool, "w-stale", lease_seconds=30)
    await _expire_lease(pool, message_id)
    current = await claim_one(pool, "w-current", lease_seconds=30)
    assert stale is not None and current is not None

    changes = await record_failed(
        pool, stale, SubmitResult(Outcome.REJECTED, 400, error="INVALID_DESTINATION"), Decision(Action.FAIL)
    )

    assert changes == []
    assert (await message_row(pool, message_id))["status"] == "QUEUED"
    assert await balance_of(pool, ACME_ID) == 250_000_000 - BD_PRICE  # no refund


async def test_two_workers_never_claim_the_same_message(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict
) -> None:
    await client.post("/v1/messages/batch", json={"messages": [sms()] * 40}, headers=acme)

    claims = await asyncio.gather(*(claim_one(pool, f"w-{i}", 30) for i in range(60)))

    ids = [c.id for c in claims if c is not None]
    assert len(ids) == len(set(ids))  # no message handed out twice
    # Some claims come back empty on purpose: SKIP LOCKED means "do not wait".
    # Whatever was skipped is still QUEUED and is picked up by the next claims.
    rest = [await claim_one(pool, "w-sweep", 30) for _ in range(40 - len(ids))]
    assert len({c.id for c in rest if c is not None} | set(ids)) == 40


# --- fairness ----------------------------------------------------------------------


async def test_an_otp_is_not_stuck_behind_a_campaign(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict, shopfast: dict
) -> None:
    campaign = {"messages": [sms(to=f"+88017220{i:05d}") for i in range(500)]}
    await client.post("/v1/messages/batch", json=campaign, headers=shopfast)
    # The campaign is already being sent when the OTP arrives.
    for _ in range(10):
        assert (await claim_one(pool, "w", 30)).tenant_id == SHOPFAST_ID

    otp = await send(client, acme, to="+971501234567")

    next_two = [await claim_one(pool, "w", 30) for _ in range(2)]
    assert otp in {str(c.id) for c in next_two}  # sent within two slots, not after 490 messages


async def test_tenants_with_backlog_take_turns(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict, shopfast: dict
) -> None:
    await client.post("/v1/messages/batch", json={"messages": [sms()] * 20}, headers=acme)
    await client.post("/v1/messages/batch", json={"messages": [sms()] * 200}, headers=shopfast)

    order = [(await claim_one(pool, "w", 30)).tenant_id for _ in range(20)]

    assert order.count(ACME_ID) == 10 and order.count(SHOPFAST_ID) == 10
    assert all(a != b for a, b in itertools.pairwise(order))  # strict alternation


async def test_fairness_with_fifty_tenants(pool: asyncpg.Pool, client: httpx.AsyncClient) -> None:
    """Each of 50 tenants with backlog gets a slot before any tenant gets a second one."""
    import hashlib
    import uuid

    keys = []
    for i in range(50):
        key = f"sk_tenant_{i}"
        keys.append(key)
        await pool.execute(
            """
            INSERT INTO tenants (id, slug, name, api_key_hash, api_key_prefix,
                                 opening_balance_micros, balance_micros)
            VALUES ($1, $2, $2, $3, 'sk_tenan', 100000000, 100000000)
            """,
            uuid.uuid4(),
            f"tenant-{i}",
            hashlib.sha256(key.encode()).hexdigest(),
        )
    for key in keys:
        await client.post("/v1/messages/batch", json={"messages": [sms()] * 5}, headers={"X-API-Key": key})

    first_round = [(await claim_one(pool, "w", 30)).tenant_id for _ in range(50)]
    second_round = [(await claim_one(pool, "w", 30)).tenant_id for _ in range(50)]

    assert len(set(first_round)) == 50
    assert len(set(second_round)) == 50


# --- rate limit ----------------------------------------------------------------------


def _max_in_any_window(times: list[float], window: float) -> int:
    best, start = 0, 0
    for end in range(len(times)):
        while times[end] - times[start] >= window:
            start += 1
        best = max(best, end - start + 1)
    return best


async def test_limiter_never_exceeds_rate_plus_burst_in_any_second(redis_client: Any) -> None:
    """Four 'workers' share one limiter and take tokens as fast as they can."""
    rate, burst = 100, 2
    limiters = [
        RateLimiter(redis_client, rate_per_second=rate, burst=burst, key="test:tat") for _ in range(4)
    ]
    granted_at: list[float] = []
    deadline = time.monotonic() + 1.6

    async def worker(limiter: RateLimiter) -> None:
        while time.monotonic() < deadline:
            granted, wait = await limiter.acquire(burst)
            granted_at.extend([time.monotonic()] * granted)
            if not granted:
                await asyncio.sleep(wait)

    await asyncio.gather(*(worker(limiter) for limiter in limiters))

    granted_at.sort()
    assert _max_in_any_window(granted_at, 1.0) <= rate + burst
    assert len(granted_at) >= rate  # and it is not uselessly slow


async def test_limiter_says_how_long_to_wait_and_honours_a_penalty(redis_client: Any) -> None:
    limiter = RateLimiter(redis_client, rate_per_second=10, burst=1, key="test:tat2")

    assert (await limiter.acquire(1))[0] == 1
    granted, wait = await limiter.acquire(1)
    assert granted == 0 and 0 < wait <= 0.1

    await limiter.penalize(0.5)  # the carrier said 429
    granted, wait = await limiter.acquire(1)
    assert granted == 0 and 0.3 < wait <= 0.5


async def test_two_dispatchers_together_stay_under_the_carrier_limit(
    client: httpx.AsyncClient, acme: dict, carrier: FakeCarrier, make_dispatcher
) -> None:
    """The real loop, two workers, a backlog: count submits as the carrier sees them."""
    await client.post("/v1/messages/batch", json={"messages": [sms()] * 400}, headers=acme)
    limit, burst = 100, 2
    settings = make_settings(carrier_rate_limit=limit, carrier_rate_headroom=0.9, carrier_burst=burst)
    stop = asyncio.Event()
    workers = [asyncio.create_task(make_dispatcher(settings, worker_id=f"w-{i}").run(stop)) for i in range(2)]

    await asyncio.sleep(1.6)
    stop.set()
    await asyncio.gather(*workers)

    assert _max_in_any_window(sorted(carrier.arrivals), 1.0) <= limit
    assert len(carrier.arrivals) >= 100  # it does use the capacity
    assert len({r["message_id"] for r in carrier.requests}) == len(carrier.requests)  # nothing sent twice


async def test_without_a_token_nothing_is_sent_and_no_attempt_is_left_behind(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict, carrier: FakeCarrier, make_dispatcher
) -> None:
    """Valkey is down. Sending without the limiter would risk the carrier limit, so we do not send."""
    message_id = await send(client, acme)
    dispatcher = make_dispatcher()

    async def limiter_is_down(_wanted: int = 1) -> tuple[int, float]:
        raise ConnectionError("valkey is not reachable")

    dispatcher._limiter.acquire = limiter_is_down  # type: ignore[method-assign]

    with pytest.raises(ConnectionError):
        await dispatcher.run_once()

    assert carrier.requests == []
    row = await message_row(pool, message_id)
    # The claim was undone: not an attempt, and above all not an ambiguous one.
    assert (row["status"], row["attempts"], row["ambiguous_attempts"]) == ("QUEUED", 0, 0)
    assert await _attempts(pool, message_id) == []


async def test_a_429_slows_every_worker_down(
    client: httpx.AsyncClient, acme: dict, carrier: FakeCarrier, make_dispatcher, redis_client: Any
) -> None:
    await send(client, acme)
    carrier.then(429)
    settings = make_settings(carrier_rate_limit=10, carrier_burst=1, carrier_429_penalty_seconds=0.5)
    await make_dispatcher(settings).run_once()

    other_worker = RateLimiter(redis_client, rate_per_second=10, burst=1)
    granted, wait = await other_worker.acquire(1)
    assert granted == 0 and wait > 0.3


async def test_a_late_result_and_a_reclaim_of_the_same_message_do_not_deadlock(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict
) -> None:
    """Worker A reports a late 503 at the instant worker B re-claims the message.
    Both touch the message row and the open attempt row; they must take the
    locks in the same order."""
    from gateway.carrier import Outcome, SubmitResult
    from gateway.dispatch import record_retry
    from gateway.retry import Action, Decision

    for _ in range(25):
        message_id = await send(client, acme)
        stale = await claim_one(pool, "w-stale", lease_seconds=30)
        assert stale is not None
        await _expire_lease(pool, message_id)

        _, reclaimed = await asyncio.gather(
            record_retry(pool, stale, SubmitResult(Outcome.UNAVAILABLE, 503), Decision(Action.RETRY)),
            claim_one(pool, "w-new", lease_seconds=30),
        )

        row = await message_row(pool, message_id)
        assert row["status"] == "QUEUED"
        # Whichever ran first, the message ends up claimed exactly once more or
        # ready to be claimed; it is never lost and never claimed twice.
        assert row["attempts"] in (1, 2)
        if reclaimed is not None:
            assert (reclaimed.attempt, row["attempts"]) == (2, 2)
        await pool.execute("UPDATE messages SET status = 'FAILED' WHERE id = $1::uuid", message_id)


# --- recording a result twice ------------------------------------------------------------


async def test_recording_an_acceptance_twice_keeps_the_carrier_id_for_the_dlr(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict
) -> None:
    """The first record_accepted committed but its acknowledgement was lost, so
    the dispatcher records the same result again. The DLR must still find the message."""
    from conftest import post_dlr
    from gateway.carrier import Outcome, SubmitResult
    from gateway.dispatch import record_accepted

    message_id = await send(client, acme)
    claimed = await claim_one(pool, "w-1", lease_seconds=30)
    assert claimed is not None
    result = SubmitResult(Outcome.ACCEPTED, 200, carrier_id="c-twice")

    await record_accepted(pool, claimed, result)
    await record_accepted(pool, claimed, result)

    carrier_ids = await pool.fetch(
        "SELECT carrier_id FROM submit_attempts WHERE message_id = $1::uuid", message_id
    )
    assert [r["carrier_id"] for r in carrier_ids] == ["c-twice"]
    response = await post_dlr(client, "c-twice", "DELIVRD")
    assert response.json() == {"result": "applied"}
    assert (await message_row(pool, message_id))["status"] == "DELIVERED"


async def test_an_idempotent_carrier_id_stays_on_the_attempt_that_got_it_first(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict
) -> None:
    """Two attempts of one message are both accepted, and a de-duplicating
    carrier returns the same carrier_id for both."""
    from gateway.carrier import Outcome, SubmitResult
    from gateway.dispatch import record_accepted

    message_id = await send(client, acme)
    first = await claim_one(pool, "w-slow", lease_seconds=30)
    await _expire_lease(pool, message_id)
    second = await claim_one(pool, "w-retry", lease_seconds=30)
    assert first is not None and second is not None
    accepted = SubmitResult(Outcome.ACCEPTED, 200, carrier_id="c-same")

    await record_accepted(pool, first, accepted)
    await record_accepted(pool, second, accepted)

    rows = await pool.fetch(
        "SELECT attempt_no, carrier_id FROM submit_attempts WHERE message_id = $1::uuid ORDER BY 1",
        message_id,
    )
    assert [(r["attempt_no"], r["carrier_id"]) for r in rows] == [(1, "c-same"), (2, None)]


async def test_recording_a_timeout_twice_counts_one_ambiguous_attempt(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict
) -> None:
    from gateway.carrier import Outcome, SubmitResult
    from gateway.dispatch import record_retry
    from gateway.retry import Action, Decision

    message_id = await send(client, acme)
    claimed = await claim_one(pool, "w-1", lease_seconds=30)
    assert claimed is not None
    timeout = SubmitResult(Outcome.TIMEOUT, error="no answer")
    decision = Decision(Action.RETRY, ambiguous=True)

    await record_retry(pool, claimed, timeout, decision)
    await record_retry(pool, claimed, timeout, decision)

    assert (await message_row(pool, message_id))["ambiguous_attempts"] == 1


# --- releasing a claim -------------------------------------------------------------


async def test_a_stale_release_cannot_undo_a_newer_claim(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict, carrier: FakeCarrier, make_dispatcher
) -> None:
    """Worker A waits for a token past its lease. Worker B claims the message and
    releases it (no token either). Then A gives up and releases too. A's release
    must not lower the attempt counter below B's closed attempt row."""
    from gateway.dispatch import release_claim

    message_id = await send(client, acme)
    slow = await claim_one(pool, "w-slow", lease_seconds=30)
    await _expire_lease(pool, message_id)
    other = await claim_one(pool, "w-other", lease_seconds=30)
    assert slow is not None and other is not None

    await release_claim(pool, other, "w-other")
    await release_claim(pool, slow, "w-slow")

    assert (await message_row(pool, message_id))["attempts"] == 1
    assert await make_dispatcher().run_once() == 1
    assert (await message_row(pool, message_id))["status"] == "SUBMITTED"
    assert await _attempts(pool, message_id) == [(1, "ABANDONED"), (2, "ACCEPTED")]


async def test_the_claim_plan_does_not_walk_a_large_backlog(pool: asyncpg.Pool) -> None:
    """Statistics taken while a 20,000-message campaign was all QUEUED, then
    half of it sent. The claim must still reach the first ready row through
    messages_dispatch_idx, not walk the primary key past every sent row."""
    from gateway.dispatch import _CLAIM

    await pool.execute(
        """
        INSERT INTO messages (id, tenant_id, to_number, sender_id, body, encoding, segments, price_prefix,
                              unit_price_micros, cost_micros, status)
        SELECT (lpad(to_hex(i), 8, '0') || '-0000-7000-8000-000000000000')::uuid, $1, '+8801711000001',
               'SHOP', 'x', 'GSM7', 1, '+880', 4000, 4000, 'QUEUED'
        FROM generate_series(1, 20000) AS i
        """,
        SHOPFAST_ID,
    )
    await pool.execute("ANALYZE messages")
    await pool.execute(
        "UPDATE messages SET status = 'DELIVERED' "
        "WHERE id < (lpad(to_hex(10001), 8, '0') || '-0000-7000-8000-000000000000')::uuid"
    )

    rows = await pool.fetch("EXPLAIN " + _CLAIM, "w-plan", timedelta(seconds=30))
    plan = "\n".join(r[0] for r in rows)

    assert "Seq Scan on messages" not in plan, plan
    assert plan.count("using messages_dispatch_idx on messages") == 2, plan


async def test_a_late_acceptance_after_the_message_failed_moves_no_money(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict, caplog: pytest.LogCaptureFixture
) -> None:
    """The reverse order of the slow-worker case: worker B's 400 fails and
    refunds the message first, then worker A's late 200 arrives, then its DLR.
    FAILED is final and the refund stands; the acceptance is logged and counted."""
    from prometheus_client import REGISTRY

    from conftest import ledger_of, post_dlr
    from gateway.carrier import Outcome, SubmitResult
    from gateway.dispatch import record_accepted, record_failed
    from gateway.retry import Action, Decision

    message_id = await send(client, acme)
    slow = await claim_one(pool, "w-slow", lease_seconds=30)
    await _expire_lease(pool, message_id)
    retry = await claim_one(pool, "w-retry", lease_seconds=30)
    assert slow is not None and retry is not None
    counted_before = REGISTRY.get_sample_value("smsgw_accepted_after_failed_total") or 0.0

    await record_failed(
        pool,
        retry,
        SubmitResult(Outcome.REJECTED, 400, error="INVALID_DESTINATION"),
        Decision(Action.FAIL, reason="INVALID_DESTINATION"),
    )
    changes = await record_accepted(pool, slow, SubmitResult(Outcome.ACCEPTED, 200, carrier_id="c-slow"))
    dlr = await post_dlr(client, "c-slow", "DELIVRD")

    assert changes == []
    assert dlr.json() == {"result": "ignored"}
    row = await message_row(pool, message_id)
    assert (row["status"], row["failure_reason"]) == ("FAILED", "INVALID_DESTINATION")
    assert await ledger_of(pool, message_id) == [("CHARGE", BD_PRICE), ("REFUND", -BD_PRICE)]
    assert await balance_of(pool, ACME_ID) == 250_000_000
    await assert_books_balance(pool)
    assert REGISTRY.get_sample_value("smsgw_accepted_after_failed_total") == counted_before + 1
    assert "after it was failed and refunded" in caplog.text


async def test_failing_for_max_attempts_without_a_submit_leaves_no_attempt_in_flight(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict, carrier: FakeCarrier, make_dispatcher
) -> None:
    """The last allowed attempt was lost with its worker. The next claim is one
    attempt too many: the message fails without a submit, and the claim's
    write-ahead row must not stay behind as a submit in flight."""
    from gateway.queries import queue_stats

    message_id = await send(client, acme)
    for worker in ("w-dead-1", "w-dead-2"):
        assert await claim_one(pool, worker, lease_seconds=30) is not None
        await _expire_lease(pool, message_id)

    await make_dispatcher(make_settings(max_attempts=2)).run_once()

    row = await message_row(pool, message_id)
    assert (row["status"], row["failure_reason"], row["attempts"]) == ("FAILED", "MAX_ATTEMPTS_EXCEEDED", 2)
    assert carrier.requests == []
    assert await _attempts(pool, message_id) == [(1, "ABANDONED"), (2, "ABANDONED")]
    assert (await queue_stats(pool))["in_flight"] == 0
    failed_detail = await pool.fetchval(
        "SELECT detail FROM message_events WHERE message_id = $1::uuid AND status = 'FAILED'", message_id
    )
    assert failed_detail["attempt"] == 2
    assert await balance_of(pool, ACME_ID) == 250_000_000
    await assert_books_balance(pool)


async def test_a_429_is_recorded_even_when_the_penalty_cannot_be_applied(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict, carrier: FakeCarrier, make_dispatcher
) -> None:
    """Valkey fails between granting the token and the carrier's 429."""
    message_id = await send(client, acme)
    carrier.then(429, "c-ok")
    dispatcher = make_dispatcher()

    async def penalty_fails(_seconds: float) -> None:
        raise ConnectionError("valkey is not reachable")

    dispatcher._limiter.penalize = penalty_fails  # type: ignore[method-assign]

    await dispatcher.run_once()
    assert await _attempts(pool, message_id) == [(1, "RATE_LIMITED")]
    await dispatcher.run_once()  # visible again after the backoff, not after the lease

    row = await message_row(pool, message_id)
    assert (row["status"], row["ambiguous_attempts"]) == ("SUBMITTED", 0)
    assert await _attempts(pool, message_id) == [(1, "RATE_LIMITED"), (2, "ACCEPTED")]
