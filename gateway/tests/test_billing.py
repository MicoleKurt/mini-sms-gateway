"""Prepaid billing: the balance never goes below zero, refunds happen once, the ledger adds up."""

from __future__ import annotations

import asyncio

import asyncpg
import httpx
import pytest

from conftest import (
    ACME_ID,
    BD_PRICE,
    FakeCarrier,
    assert_books_balance,
    balance_of,
    ledger_of,
    message_row,
    post_dlr,
    send,
    sms,
)


async def _set_balance(pool: asyncpg.Pool, micros: int) -> None:
    await pool.execute(
        "UPDATE tenants SET balance_micros = $2, opening_balance_micros = $2 WHERE id = $1", ACME_ID, micros
    )


async def test_concurrent_sends_cannot_overspend(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict
) -> None:
    """Money for 10 messages, 60 requests at the same time."""
    await _set_balance(pool, 10 * BD_PRICE)

    responses = await asyncio.gather(
        *(client.post("/v1/messages", json=sms(client_ref=f"r-{i}"), headers=acme) for i in range(60))
    )

    statuses = [r.status_code for r in responses]
    assert statuses.count(202) == 10
    assert statuses.count(402) == 50
    assert {r.json()["error"]["code"] for r in responses if r.status_code == 402} == {"INSUFFICIENT_BALANCE"}
    assert await balance_of(pool, ACME_ID) == 0
    assert await pool.fetchval("SELECT count(*) FROM messages") == 10
    assert await pool.fetchval("SELECT count(*) FROM ledger_entries") == 10
    await assert_books_balance(pool)


async def test_concurrent_batches_cannot_overspend(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict
) -> None:
    """Money for 250 messages; eight batches of 100 race for it."""
    await _set_balance(pool, 250 * BD_PRICE)
    batch = {"messages": [sms() for _ in range(100)]}

    responses = await asyncio.gather(
        *(client.post("/v1/messages/batch", json=batch, headers=acme) for _ in range(8))
    )

    assert sorted(r.status_code for r in responses) == [202, 202, 402, 402, 402, 402, 402, 402]
    assert await balance_of(pool, ACME_ID) == 50 * BD_PRICE
    assert await pool.fetchval("SELECT count(*) FROM messages") == 200
    await assert_books_balance(pool)


async def test_a_batch_larger_than_the_balance_charges_nothing(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict
) -> None:
    await _set_balance(pool, 99 * BD_PRICE)
    response = await client.post("/v1/messages/batch", json={"messages": [sms()] * 100}, headers=acme)

    assert response.status_code == 402
    assert await balance_of(pool, ACME_ID) == 99 * BD_PRICE
    assert await pool.fetchval("SELECT count(*) FROM messages") == 0


async def test_the_database_refuses_a_negative_balance(pool: asyncpg.Pool) -> None:
    """The CHECK constraint is the last line of defence if application code is ever wrong."""
    with pytest.raises(asyncpg.CheckViolationError):
        await pool.execute("UPDATE tenants SET balance_micros = -1 WHERE id = $1", ACME_ID)


async def test_the_database_refuses_a_second_charge_for_a_message(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict
) -> None:
    message_id = await send(client, acme)
    with pytest.raises(asyncpg.UniqueViolationError):
        await pool.execute(
            """
            INSERT INTO ledger_entries (tenant_id, message_id, kind, amount_micros, balance_after_micros)
            VALUES ($1, $2::uuid, 'CHARGE', 4000, 0)
            """,
            ACME_ID,
            message_id,
        )


async def test_refund_when_the_carrier_rejects_permanently(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict, carrier: FakeCarrier, make_dispatcher
) -> None:
    message_id = await send(client, acme)
    carrier.then(400)

    await make_dispatcher().run_once()

    assert (await message_row(pool, message_id))["status"] == "FAILED"
    assert await ledger_of(pool, message_id) == [("CHARGE", BD_PRICE), ("REFUND", -BD_PRICE)]
    assert await balance_of(pool, ACME_ID) == 250_000_000
    await assert_books_balance(pool)


async def test_no_refund_when_the_carrier_accepted_but_delivery_failed(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict, carrier: FakeCarrier, make_dispatcher
) -> None:
    """UNDELIV and EXPIRED come after the carrier accepted, so the carrier has charged us."""
    undelivered = await send(client, acme)
    expired = await send(client, acme)
    carrier.then("c-undeliv", "c-expired")
    dispatcher = make_dispatcher()
    await dispatcher.run_once()

    await post_dlr(client, "c-undeliv", "UNDELIV")
    await post_dlr(client, "c-expired", "EXPIRED")

    statuses = {(await message_row(pool, m))["status"] for m in (undelivered, expired)}
    assert statuses == {"UNDELIVERED", "EXPIRED"}
    assert await pool.fetchval("SELECT count(*) FROM ledger_entries WHERE kind = 'REFUND'") == 0
    assert await balance_of(pool, ACME_ID) == 250_000_000 - 2 * BD_PRICE
    await assert_books_balance(pool)


async def test_balance_endpoint_reports_the_invariant(
    client: httpx.AsyncClient, acme: dict, carrier: FakeCarrier, make_dispatcher
) -> None:
    await send(client, acme)
    await send(client, acme)
    carrier.then(400)  # one of the two is refunded
    await make_dispatcher().run_once()

    balance = (await client.get("/v1/balance", headers=acme)).json()

    assert balance["consistent"] is True
    assert balance["charged_micros"] == 2 * BD_PRICE
    assert balance["refunded_micros"] == BD_PRICE
    assert balance["ledger_total_micros"] == BD_PRICE
    assert balance["balance_micros"] == balance["opening_balance_micros"] - balance["ledger_total_micros"]


async def test_ledger_endpoint_pages_through_every_entry(client: httpx.AsyncClient, acme: dict) -> None:
    await client.post("/v1/messages/batch", json={"messages": [sms()] * 25}, headers=acme)

    entries: list[dict] = []
    cursor = None
    while True:
        params = {"limit": 10, **({"cursor": cursor} if cursor else {})}
        page = (await client.get("/v1/ledger", params=params, headers=acme)).json()
        entries += page["data"]
        cursor = page["next_cursor"]
        if cursor is None:
            break

    assert len(entries) == 25
    assert sum(e["amount_micros"] for e in entries) == 25 * BD_PRICE
    # The running balance decreases by one charge per row, with no gaps.
    balances = [e["balance_after_micros"] for e in entries]
    assert balances == [250_000_000 - BD_PRICE * (i + 1) for i in range(25)]
