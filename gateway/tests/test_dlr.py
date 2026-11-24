"""Delivery receipts: early, duplicate, late, conflicting and unsigned."""

from __future__ import annotations

import asyncio

import asyncpg
import httpx
import pytest

from conftest import FakeCarrier, event_statuses, message_row, post_dlr, send
from gateway.carrier import Outcome, SubmitResult
from gateway.dispatch import claim_one, record_accepted


async def _submitted(client, acme, carrier, make_dispatcher, carrier_id: str = "c-1") -> str:
    message_id = await send(client, acme)
    carrier.then(carrier_id)
    await make_dispatcher().run_once()
    return message_id


async def _dlr_rows(pool: asyncpg.Pool) -> list[tuple[str, str, str]]:
    rows = await pool.fetch("SELECT carrier_id, status, disposition FROM dlr_receipts ORDER BY id")
    return [(r["carrier_id"], r["status"], r["disposition"]) for r in rows]


async def test_dlr_moves_a_submitted_message_to_its_final_status(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict, carrier: FakeCarrier, make_dispatcher
) -> None:
    message_id = await _submitted(client, acme, carrier, make_dispatcher)

    response = await post_dlr(client, "c-1", "DELIVRD")

    assert (response.status_code, response.json()) == (200, {"result": "applied"})
    row = await message_row(pool, message_id)
    assert row["status"] == "DELIVERED" and row["finalized_at"] is not None
    assert await event_statuses(pool, message_id) == ["ACCEPTED", "QUEUED", "SUBMITTED", "DELIVERED"]


async def test_dlr_that_arrives_before_the_submit_response_is_not_lost(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict
) -> None:
    """The carrier's DLR overtakes its own submit response."""
    message_id = await send(client, acme)
    claimed = await claim_one(pool, "w-1", lease_seconds=30)  # the submit is in flight
    assert claimed is not None

    early = await post_dlr(client, "c-early", "DELIVRD")

    # We do not know "c-early" yet. The receipt is stored, the message is untouched.
    assert (early.status_code, early.json()) == (200, {"result": "pending"})
    assert (await message_row(pool, message_id))["status"] == "QUEUED"
    assert await _dlr_rows(pool) == [("c-early", "DELIVRD", "PENDING")]

    # Now the submit response arrives and tells us the carrier_id.
    await record_accepted(pool, claimed, SubmitResult(Outcome.ACCEPTED, 200, carrier_id="c-early"))

    row = await message_row(pool, message_id)
    assert row["status"] == "DELIVERED"  # not overwritten by the later SUBMITTED
    # History is complete and in order: it passed through SUBMITTED.
    assert await event_statuses(pool, message_id) == ["ACCEPTED", "QUEUED", "SUBMITTED", "DELIVERED"]
    assert await _dlr_rows(pool) == [("c-early", "DELIVRD", "APPLIED")]


async def test_dlr_and_submit_response_at_the_same_instant(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict
) -> None:
    """Run the race itself, many times: whichever side wins, the message ends DELIVERED."""
    for i in range(25):
        message_id = await send(client, acme)
        claimed = await claim_one(pool, "w-1", lease_seconds=30)
        assert claimed is not None
        carrier_id = f"c-race-{i}"

        await asyncio.gather(
            post_dlr(client, carrier_id, "DELIVRD"),
            record_accepted(pool, claimed, SubmitResult(Outcome.ACCEPTED, 200, carrier_id=carrier_id)),
        )

        assert (await message_row(pool, message_id))["status"] == "DELIVERED", f"round {i}"
        assert await event_statuses(pool, message_id) == ["ACCEPTED", "QUEUED", "SUBMITTED", "DELIVERED"]


async def test_duplicate_dlr_has_no_effect(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict, carrier: FakeCarrier, make_dispatcher
) -> None:
    await pool.execute("UPDATE tenants SET callback_url = 'http://tenant.example/hook'")
    message_id = await _submitted(client, acme, carrier, make_dispatcher)
    await post_dlr(client, "c-1", "DELIVRD")
    before = await message_row(pool, message_id)

    again = await post_dlr(client, "c-1", "DELIVRD")

    assert (again.status_code, again.json()) == (200, {"result": "duplicate"})
    assert await message_row(pool, message_id) == before  # not one column changed
    assert await event_statuses(pool, message_id) == ["ACCEPTED", "QUEUED", "SUBMITTED", "DELIVERED"]
    assert await pool.fetchval("SELECT count(*) FROM dlr_receipts") == 1
    assert await pool.fetchval("SELECT count(*) FROM webhook_deliveries") == 1  # one callback, not two


async def test_ten_copies_of_a_dlr_at_once(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict, carrier: FakeCarrier, make_dispatcher
) -> None:
    message_id = await _submitted(client, acme, carrier, make_dispatcher)

    responses = await asyncio.gather(*(post_dlr(client, "c-1", "DELIVRD") for _ in range(10)))

    results = sorted(r.json()["result"] for r in responses)
    assert results == ["applied"] + ["duplicate"] * 9
    assert await event_statuses(pool, message_id) == ["ACCEPTED", "QUEUED", "SUBMITTED", "DELIVERED"]


async def test_a_final_status_is_never_replaced(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict, carrier: FakeCarrier, make_dispatcher
) -> None:
    """DELIVRD, then a contradicting UNDELIV for the same carrier_id."""
    message_id = await _submitted(client, acme, carrier, make_dispatcher)
    await post_dlr(client, "c-1", "DELIVRD")

    late = await post_dlr(client, "c-1", "UNDELIV")

    assert late.json() == {"result": "ignored"}
    assert (await message_row(pool, message_id))["status"] == "DELIVERED"
    assert await _dlr_rows(pool) == [("c-1", "DELIVRD", "APPLIED"), ("c-1", "UNDELIV", "IGNORED")]


async def test_status_cannot_move_backwards(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict, carrier: FakeCarrier, make_dispatcher
) -> None:
    """Try every backward and sideways move on a DELIVERED message."""
    from gateway.messages import transition

    message_id = await _submitted(client, acme, carrier, make_dispatcher)
    await post_dlr(client, "c-1", "DELIVRD")
    row = await message_row(pool, message_id)

    async with pool.acquire() as conn, conn.transaction():
        for target in ("QUEUED", "SUBMITTED", "FAILED", "UNDELIVERED", "EXPIRED", "DELIVERED"):
            assert await transition(conn, row["id"], target, detail={}) is None

    assert (await message_row(pool, message_id))["status"] == "DELIVERED"
    assert await event_statuses(pool, message_id) == ["ACCEPTED", "QUEUED", "SUBMITTED", "DELIVERED"]


async def test_dlr_for_an_unknown_carrier_id_is_kept(client: httpx.AsyncClient, pool: asyncpg.Pool) -> None:
    """The receipt of a submit that timed out on our side: we never learn its ID."""
    response = await post_dlr(client, "c-nobody-knows", "DELIVRD")

    assert (response.status_code, response.json()) == (200, {"result": "pending"})
    assert await _dlr_rows(pool) == [("c-nobody-knows", "DELIVRD", "PENDING")]


# --- signature -------------------------------------------------------------------------


@pytest.mark.parametrize(
    "signature",
    [
        None,  # header missing
        "",
        "deadbeef",
        "0" * 64,  # right length, wrong value
        "sha256=abc",
    ],
)
async def test_dlr_without_a_valid_signature_changes_nothing(
    client: httpx.AsyncClient,
    pool: asyncpg.Pool,
    acme: dict,
    carrier: FakeCarrier,
    make_dispatcher,
    signature: str | None,
) -> None:
    message_id = await _submitted(client, acme, carrier, make_dispatcher)

    response = await post_dlr(client, "c-1", "DELIVRD", signature=signature)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INVALID_SIGNATURE"
    assert (await message_row(pool, message_id))["status"] == "SUBMITTED"
    assert await pool.fetchval("SELECT count(*) FROM dlr_receipts") == 0
    assert await event_statuses(pool, message_id) == ["ACCEPTED", "QUEUED", "SUBMITTED"]


async def test_signature_covers_the_exact_body(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict, carrier: FakeCarrier, make_dispatcher
) -> None:
    """A valid signature for one body does not authorise a different body."""
    from conftest import DLR_SECRET
    from gateway import dlr

    await _submitted(client, acme, carrier, make_dispatcher)
    signed = b'{"carrier_id":"c-1","status":"UNDELIV","timestamp":"2026-11-24T10:00:00Z"}'
    tampered = signed.replace(b"UNDELIV", b"DELIVRD")

    response = await client.post(
        "/carrier/dlr",
        content=tampered,
        headers={"X-Signature": dlr.sign(DLR_SECRET, signed), "Content-Type": "application/json"},
    )

    assert response.status_code == 401
    assert await pool.fetchval("SELECT count(*) FROM dlr_receipts") == 0


async def test_signed_but_malformed_dlr_is_a_422(client: httpx.AsyncClient, pool: asyncpg.Pool) -> None:
    response = await post_dlr(client, "c-1", "SENT")
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "status"
    assert await pool.fetchval("SELECT count(*) FROM dlr_receipts") == 0
