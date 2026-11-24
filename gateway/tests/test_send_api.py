"""The send API: what is accepted, what is rejected, and that a rejection creates nothing."""

from __future__ import annotations

import asyncpg
import httpx
import pytest

from conftest import ACME_ID, BD_NUMBER, BD_PRICE, balance_of, event_statuses, ledger_of, message_row, sms
from gateway.validation import is_e164, is_sender_id


async def _nothing_was_created(pool: asyncpg.Pool) -> bool:
    messages = await pool.fetchval("SELECT count(*) FROM messages")
    ledger = await pool.fetchval("SELECT count(*) FROM ledger_entries")
    return messages == 0 and ledger == 0 and await balance_of(pool, ACME_ID) == 250_000_000


async def test_accepts_a_message_and_queues_it(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict
) -> None:
    response = await client.post("/v1/messages", json=sms(client_ref="otp-1"), headers=acme)

    assert response.status_code == 202
    body = response.json()
    assert body["status"] == "ACCEPTED"
    assert (body["encoding"], body["segments"], body["cost_micros"]) == ("GSM7", 1, BD_PRICE)
    assert body["client_ref"] == "otp-1"

    row = await message_row(pool, body["id"])
    assert row["status"] == "QUEUED"
    assert await event_statuses(pool, body["id"]) == ["ACCEPTED", "QUEUED"]
    assert await ledger_of(pool, body["id"]) == [("CHARGE", BD_PRICE)]
    assert await balance_of(pool, ACME_ID) == 250_000_000 - BD_PRICE


async def test_price_is_segments_times_destination_price(client: httpx.AsyncClient, acme: dict) -> None:
    two_segments_to_uae = sms(to="+971501234567", text="a" * 161)
    body = (await client.post("/v1/messages", json=two_segments_to_uae, headers=acme)).json()
    assert (body["segments"], body["cost_micros"]) == (2, 2 * 21_000)

    bangla = sms(text="আপনার কোড 482913")
    body = (await client.post("/v1/messages", json=bangla, headers=acme)).json()
    assert (body["encoding"], body["segments"], body["cost_micros"]) == ("UCS2", 1, BD_PRICE)


@pytest.mark.parametrize(
    "bad_number",
    [
        "8801711000001",  # no plus
        "+0801711000001",  # country code cannot start with 0
        "+880 1711 000001",  # spaces: we do not strip them
        "+880-1711-000001",
        "+12345",  # too short
        "+1234567890123456",  # 16 digits
        "+8801711000001\n",  # trailing newline
        "+৮৮০১৭১১০০০০০১",  # Bengali digits are digits, but not E.164
        "",
    ],
)
async def test_rejects_a_number_that_is_not_e164(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict, bad_number: str
) -> None:
    response = await client.post("/v1/messages", json=sms(to=bad_number), headers=acme)

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert error["details"] == [
        {"field": "to", "code": "INVALID_E164", "message": error["details"][0]["message"]}
    ]
    assert await _nothing_was_created(pool)


async def test_rejects_a_destination_without_a_price(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict
) -> None:
    response = await client.post("/v1/messages", json=sms(to="+4915112345678"), headers=acme)  # Germany
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["code"] == "UNSUPPORTED_DESTINATION"
    assert await _nothing_was_created(pool)


async def test_reports_every_problem_at_once(client: httpx.AsyncClient, acme: dict) -> None:
    response = await client.post(
        "/v1/messages", json={"to": "nope", "from": "WAY-TOO-LONG-SENDER", "text": ""}, headers=acme
    )
    codes = {(d["field"], d["code"]) for d in response.json()["error"]["details"]}
    assert codes == {("to", "INVALID_E164"), ("from", "INVALID_SENDER_ID"), ("text", "EMPTY_TEXT")}


async def test_rejects_missing_and_unknown_fields(client: httpx.AsyncClient, acme: dict) -> None:
    missing = await client.post("/v1/messages", json={"to": BD_NUMBER, "from": "ACME"}, headers=acme)
    assert missing.status_code == 422
    assert missing.json()["error"]["details"] == [
        {"field": "text", "code": "REQUIRED", "message": "Field required"}
    ]

    unknown = await client.post("/v1/messages", json=sms(priority="high"), headers=acme)
    assert unknown.status_code == 422
    assert unknown.json()["error"]["details"][0]["field"] == "priority"


async def test_rejects_a_message_longer_than_ten_segments(client: httpx.AsyncClient, acme: dict) -> None:
    response = await client.post("/v1/messages", json=sms(text="a" * (153 * 10 + 1)), headers=acme)
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["code"] == "MESSAGE_TOO_LONG"


async def test_requires_an_api_key(client: httpx.AsyncClient) -> None:
    for headers in ({}, {"X-API-Key": "not-a-real-key"}):
        # Even with a body that would fail validation, the answer is 401:
        # an unauthenticated caller learns nothing about the API.
        response = await client.post("/v1/messages", json={"to": "bad"}, headers=headers)
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "UNAUTHORIZED"


async def test_batch_accepts_all_messages_in_one_charge(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict
) -> None:
    messages = [sms(to=f"+88017110{i:05d}", client_ref=f"c-{i}") for i in range(250)]
    response = await client.post("/v1/messages/batch", json={"messages": messages}, headers=acme)

    assert response.status_code == 202
    body = response.json()
    assert (body["count"], body["total_cost_micros"]) == (250, 250 * BD_PRICE)
    assert [m["client_ref"] for m in body["messages"]] == [f"c-{i}" for i in range(250)]
    assert len({m["id"] for m in body["messages"]}) == 250

    assert (
        await pool.fetchval("SELECT count(*) FROM messages WHERE batch_id = $1::uuid", body["batch_id"])
        == 250
    )
    assert await pool.fetchval("SELECT count(*) FROM ledger_entries WHERE kind = 'CHARGE'") == 250
    assert await balance_of(pool, ACME_ID) == 250_000_000 - 250 * BD_PRICE
    # The running balance on the last ledger row is the tenant's balance.
    last = await pool.fetchval("SELECT balance_after_micros FROM ledger_entries ORDER BY id DESC LIMIT 1")
    assert last == await balance_of(pool, ACME_ID)


async def test_batch_is_all_or_nothing(client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict) -> None:
    messages = [sms(), sms(to="not-a-number"), sms(), sms(to="+4915112345678")]
    response = await client.post("/v1/messages/batch", json={"messages": messages}, headers=acme)

    assert response.status_code == 422
    details = response.json()["error"]["details"]
    assert [(d["index"], d["code"]) for d in details] == [(1, "INVALID_E164"), (3, "UNSUPPORTED_DESTINATION")]
    assert await _nothing_was_created(pool)


async def test_batch_size_limits(client: httpx.AsyncClient, acme: dict) -> None:
    too_many = await client.post("/v1/messages/batch", json={"messages": [sms()] * 1001}, headers=acme)
    assert too_many.status_code == 422
    assert too_many.json()["error"]["details"][0]["code"] == "BATCH_TOO_LARGE"

    empty = await client.post("/v1/messages/batch", json={"messages": []}, headers=acme)
    assert empty.status_code == 422
    assert empty.json()["error"]["details"][0]["code"] == "BATCH_EMPTY"


async def test_list_filters_and_pages(client: httpx.AsyncClient, acme: dict) -> None:
    messages = [sms(client_ref=f"ref-{i}") for i in range(5)]
    await client.post("/v1/messages/batch", json={"messages": messages}, headers=acme)

    by_ref = (await client.get("/v1/messages", params={"client_ref": "ref-3"}, headers=acme)).json()
    assert [m["client_ref"] for m in by_ref["data"]] == ["ref-3"]

    none = (await client.get("/v1/messages", params={"status": "DELIVERED"}, headers=acme)).json()
    assert none == {"data": [], "next_cursor": None}

    future = (
        await client.get("/v1/messages", params={"created_from": "2099-01-01T00:00:00Z"}, headers=acme)
    ).json()
    assert future["data"] == []

    seen: list[str] = []
    cursor = None
    for _ in range(3):
        params = {"limit": 2, **({"cursor": cursor} if cursor else {})}
        page = (await client.get("/v1/messages", params=params, headers=acme)).json()
        seen += [m["id"] for m in page["data"]]
        cursor = page["next_cursor"]
    assert cursor is None
    assert len(seen) == 5 and len(set(seen)) == 5

    bad_status = await client.get("/v1/messages", params={"status": "SENT"}, headers=acme)
    assert bad_status.status_code == 422


def test_e164_and_sender_rules() -> None:
    assert is_e164("+8801711000001") and is_e164("+971501234567") and is_e164("+1234567")
    assert not is_e164("+1234567890123456") and not is_e164("001234567890")
    assert is_sender_id("ACME") and is_sender_id("Shop Fast") and is_sender_id("12345")
    assert is_sender_id("880171100000123")  # 15 digit numeric sender
    assert not is_sender_id("") and not is_sender_id("   ") and not is_sender_id("TWELVE_CHARS")
    assert not is_sender_id("ACME-BANK")
