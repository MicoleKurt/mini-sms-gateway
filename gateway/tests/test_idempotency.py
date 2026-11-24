"""Idempotency-Key: a retried request must not create a second message or a second charge."""

from __future__ import annotations

import asyncio

import asyncpg
import httpx

from conftest import ACME_ID, BD_PRICE, SHOPFAST_ID, balance_of, sms


async def _counts(pool: asyncpg.Pool) -> tuple[int, int]:
    messages = await pool.fetchval("SELECT count(*) FROM messages")
    charges = await pool.fetchval("SELECT count(*) FROM ledger_entries WHERE kind = 'CHARGE'")
    return messages, charges


async def test_same_key_same_body_creates_one_message_and_one_charge(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict
) -> None:
    headers = {**acme, "Idempotency-Key": "order-42"}

    first = await client.post("/v1/messages", json=sms(), headers=headers)
    second = await client.post("/v1/messages", json=sms(), headers=headers)

    assert first.status_code == second.status_code == 202
    assert second.json() == first.json()  # the original response, same message ID
    assert "Idempotent-Replay" not in first.headers
    assert second.headers["Idempotent-Replay"] == "true"
    assert await _counts(pool) == (1, 1)
    assert await balance_of(pool, ACME_ID) == 250_000_000 - BD_PRICE


async def test_same_key_different_body_is_an_error(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict
) -> None:
    headers = {**acme, "Idempotency-Key": "order-42"}
    await client.post("/v1/messages", json=sms(text="first"), headers=headers)

    response = await client.post("/v1/messages", json=sms(text="second"), headers=headers)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"
    assert await _counts(pool) == (1, 1)


async def test_concurrent_requests_with_one_key_create_one_message(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict
) -> None:
    """Twenty copies of the same request at once: the client's retry storm."""
    headers = {**acme, "Idempotency-Key": "storm"}

    responses = await asyncio.gather(
        *(client.post("/v1/messages", json=sms(), headers=headers) for _ in range(20))
    )

    assert {r.status_code for r in responses} == {202}
    assert len({r.json()["id"] for r in responses}) == 1
    assert await _counts(pool) == (1, 1)
    assert await balance_of(pool, ACME_ID) == 250_000_000 - BD_PRICE


async def test_batch_replay_returns_the_same_ids(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict
) -> None:
    headers = {**acme, "Idempotency-Key": "campaign-7"}
    payload = {"messages": [sms(client_ref=f"c-{i}") for i in range(50)]}

    first = await client.post("/v1/messages/batch", json=payload, headers=headers)
    second = await client.post("/v1/messages/batch", json=payload, headers=headers)

    assert second.json() == first.json()
    assert await _counts(pool) == (50, 50)
    assert await balance_of(pool, ACME_ID) == 250_000_000 - 50 * BD_PRICE


async def test_keys_are_per_tenant(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict, shopfast: dict
) -> None:
    key = {"Idempotency-Key": "shared-key"}
    a = await client.post("/v1/messages", json=sms(), headers={**acme, **key})
    b = await client.post("/v1/messages", json=sms(), headers={**shopfast, **key})

    assert a.json()["id"] != b.json()["id"]
    assert await _counts(pool) == (2, 2)
    assert await balance_of(pool, SHOPFAST_ID) == 1_000_000_000 - BD_PRICE


async def test_a_rejected_request_does_not_burn_the_key(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict
) -> None:
    """A request that failed (here: not enough balance) stored nothing, so the
    client can fix the cause and retry with the same key."""
    headers = {**acme, "Idempotency-Key": "retry-after-topup"}
    await pool.execute(
        "UPDATE tenants SET balance_micros = 0, opening_balance_micros = 0 WHERE id = $1", ACME_ID
    )

    rejected = await client.post("/v1/messages", json=sms(), headers=headers)
    assert rejected.status_code == 402
    assert await _counts(pool) == (0, 0)

    await pool.execute(
        "UPDATE tenants SET balance_micros = 10000, opening_balance_micros = 10000 WHERE id = $1", ACME_ID
    )
    accepted = await client.post("/v1/messages", json=sms(), headers=headers)
    assert accepted.status_code == 202
    assert await _counts(pool) == (1, 1)


async def test_replay_does_not_depend_on_current_state(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict
) -> None:
    """The retry gets the original answer even if the request would now be refused."""
    headers = {**acme, "Idempotency-Key": "k"}
    first = await client.post("/v1/messages", json=sms(), headers=headers)
    await pool.execute("DELETE FROM prices")  # the destination is no longer priced

    replay = await client.post("/v1/messages", json=sms(), headers=headers)

    assert replay.status_code == 202
    assert replay.json() == first.json()
