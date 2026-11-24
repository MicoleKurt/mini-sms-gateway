"""Hostile input: values a real client does not send must get a 4xx with the
documented error envelope, never a 500 or a plain-text page."""

from __future__ import annotations

import base64
import json
import uuid
from typing import Any

import asyncpg
import httpx
import pytest

from conftest import DLR_SECRET, send
from gateway import dlr


def _cursor(parts: Any) -> str:
    return base64.urlsafe_b64encode(json.dumps(parts).encode()).decode().rstrip("=")


def _raw_cursor(raw: str) -> str:
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def _assert_422(response: httpx.Response, field: str) -> None:
    assert response.status_code == 422, response.text
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert error["details"][0]["field"] == field


@pytest.mark.parametrize(
    ("params", "field"),
    [
        ({"client_ref": "a\x00b"}, "client_ref"),
        ({"client_ref": ""}, "client_ref"),
        ({"client_ref": "x" * 65}, "client_ref"),
        # Valid ISO 8601, but outside the datetime range once moved to UTC.
        ({"created_from": "0001-01-01T00:00:00+14:00"}, "created_from"),
        ({"created_to": "9999-12-31T23:59:59-12:00"}, "created_to"),
        ({"cursor": _cursor(["0001-01-01T00:00:00+14:00", str(uuid.uuid4())])}, "cursor"),
        ({"cursor": _raw_cursor("[" * 3000)}, "cursor"),
        ({"cursor": "A" * 10_000}, "cursor"),
        ({"limit": "0"}, "limit"),
        ({"limit": "-5"}, "limit"),
        ({"limit": "1001"}, "limit"),
        ({"limit": str(10**30)}, "limit"),
        ({"limit": "1e400"}, "limit"),
    ],
)
async def test_hostile_message_list_queries_are_a_422(
    client: httpx.AsyncClient, acme: dict, params: dict[str, str], field: str
) -> None:
    _assert_422(await client.get("/v1/messages", params=params, headers=acme), field)


@pytest.mark.parametrize(
    "cursor",
    [
        _cursor(["99999999999999999999999999"]),  # larger than a bigint
        _cursor(["-1"]),
        _raw_cursor("[" * 3000),
    ],
)
async def test_a_forged_ledger_cursor_is_a_422(client: httpx.AsyncClient, acme: dict, cursor: str) -> None:
    _assert_422(await client.get("/v1/ledger", params={"cursor": cursor}, headers=acme), "cursor")


@pytest.mark.parametrize(
    ("params", "field"),
    [
        ({"q": "a\x00"}, "q"),
        ({"created_from": "0001-01-01T00:00:00+14:00"}, "created_from"),
        ({"cursor": _cursor(["0001-01-01T00:00:00+14:00", str(uuid.uuid4())])}, "cursor"),
    ],
)
async def test_hostile_internal_list_queries_are_a_422(
    client: httpx.AsyncClient, admin: dict, params: dict[str, str], field: str
) -> None:
    _assert_422(await client.get("/internal/messages", params=params, headers=admin), field)


async def test_a_time_with_an_offset_still_filters_correctly(client: httpx.AsyncClient, acme: dict) -> None:
    message_id = await send(client, acme)

    before = {"created_to": "2000-01-01T05:00:00+05:00"}
    after = {"created_from": "2000-01-01T05:00:00+05:00"}

    earlier = (await client.get("/v1/messages", params=before, headers=acme)).json()["data"]
    later = (await client.get("/v1/messages", params=after, headers=acme)).json()["data"]

    assert earlier == []
    assert [m["id"] for m in later] == [message_id]


async def test_an_unexpected_error_is_a_json_500_without_the_traceback(
    client: httpx.AsyncClient, caplog: pytest.LogCaptureFixture
) -> None:
    app = client._transport.app  # type: ignore[attr-defined]

    async def boom() -> None:
        raise RuntimeError("secret detail from deep inside")

    app.add_api_route("/test-boom", boom)

    response = await client.get("/test-boom")

    assert response.status_code == 500
    assert response.json() == {"error": {"code": "INTERNAL_ERROR", "message": "Internal error."}}
    assert "secret detail" not in response.text
    assert "secret detail from deep inside" in caplog.text  # logged for us, not sent to the caller


# --- carrier DLR ---------------------------------------------------------------------------


async def _signed_dlr(client: httpx.AsyncClient, raw: bytes) -> httpx.Response:
    headers = {"Content-Type": "application/json", "X-Signature": dlr.sign(DLR_SECRET, raw)}
    return await client.post("/carrier/dlr", content=raw, headers=headers)


@pytest.mark.parametrize(
    ("raw", "field"),
    [
        (b"[" * 100_000, "body"),  # nesting deeper than the JSON parser's recursion limit
        (
            b'{"carrier_id": "c\\ud800", "status": "DELIVRD", "timestamp": "2026-11-24T10:00:00Z"}',
            "carrier_id",
        ),
        (
            b'{"carrier_id": "c-1", "status": "DELIVRD", "timestamp": "0001-01-01T00:00:00+14:00"}',
            "timestamp",
        ),
        (
            b'{"carrier_id": "c-1", "status": "DELIVRD", "timestamp": "9999-12-31T23:59:59-12:00"}',
            "timestamp",
        ),
    ],
)
async def test_a_signed_but_hostile_dlr_is_a_422(
    client: httpx.AsyncClient, pool: asyncpg.Pool, raw: bytes, field: str
) -> None:
    _assert_422(await _signed_dlr(client, raw), field)
    assert await pool.fetchval("SELECT count(*) FROM dlr_receipts") == 0


async def test_a_dlr_timestamp_with_an_offset_is_stored_as_the_same_instant(
    client: httpx.AsyncClient, pool: asyncpg.Pool
) -> None:
    raw = b'{"carrier_id": "c-1", "status": "DELIVRD", "timestamp": "2026-11-24T15:00:00+05:00"}'

    assert (await _signed_dlr(client, raw)).status_code == 200

    stored = await pool.fetchval("SELECT carrier_timestamp FROM dlr_receipts")
    assert stored.isoformat() == "2026-11-24T10:00:00+00:00"
