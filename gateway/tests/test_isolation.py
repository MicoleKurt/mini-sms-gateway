"""Tenant isolation: a tenant sees its own data and nothing else."""

from __future__ import annotations

import asyncpg
import httpx

from conftest import ACME_ID, BD_PRICE, send, sms


async def test_a_tenant_cannot_read_another_tenants_message(
    client: httpx.AsyncClient, acme: dict, shopfast: dict
) -> None:
    acme_message = await send(client, acme)

    own = await client.get(f"/v1/messages/{acme_message}", headers=acme)
    other = await client.get(f"/v1/messages/{acme_message}", headers=shopfast)
    missing = await client.get("/v1/messages/00000000-0000-7000-8000-000000000000", headers=shopfast)

    assert own.status_code == 200
    assert [e["status"] for e in own.json()["events"]] == ["ACCEPTED", "QUEUED"]
    # 404, not 403, and the same body as for an ID that does not exist at all:
    # the response must not confirm that the message exists.
    assert other.status_code == 404
    assert other.json() == missing.json()


async def test_lists_counts_balance_and_ledger_are_scoped_to_the_tenant(
    client: httpx.AsyncClient, acme: dict, shopfast: dict
) -> None:
    acme_ids = {await send(client, acme, client_ref="same-ref") for _ in range(3)}
    shop_id = await send(client, shopfast, client_ref="same-ref")

    acme_list = (await client.get("/v1/messages", headers=acme)).json()["data"]
    shop_list = (await client.get("/v1/messages", headers=shopfast)).json()["data"]
    assert {m["id"] for m in acme_list} == acme_ids
    assert {m["id"] for m in shop_list} == {shop_id}

    # A filter the other tenant's rows would also match does not leak them.
    by_ref = (await client.get("/v1/messages", params={"client_ref": "same-ref"}, headers=shopfast)).json()
    assert {m["id"] for m in by_ref["data"]} == {shop_id}

    assert (await client.get("/v1/messages/stats", headers=acme)).json()["total"] == 3
    assert (await client.get("/v1/messages/stats", headers=shopfast)).json()["total"] == 1

    acme_balance = (await client.get("/v1/balance", headers=acme)).json()
    shop_balance = (await client.get("/v1/balance", headers=shopfast)).json()
    assert (acme_balance["tenant"], acme_balance["charged_micros"]) == ("acme-bank", 3 * BD_PRICE)
    assert (shop_balance["tenant"], shop_balance["charged_micros"]) == ("shopfast", BD_PRICE)

    shop_ledger = (await client.get("/v1/ledger", headers=shopfast)).json()["data"]
    assert [entry["message_id"] for entry in shop_ledger] == [shop_id]


async def test_a_malformed_message_id_is_a_404(client: httpx.AsyncClient, acme: dict) -> None:
    response = await client.get("/v1/messages/not-a-uuid", headers=acme)
    assert response.status_code == 404


async def test_every_tenant_route_requires_a_key(client: httpx.AsyncClient) -> None:
    for path in ("/v1/messages", "/v1/messages/stats", "/v1/balance", "/v1/ledger", "/v1/webhook"):
        assert (await client.get(path)).status_code == 401, path


async def test_an_api_key_is_stored_only_as_a_hash(pool: asyncpg.Pool) -> None:
    from conftest import ACME_KEY

    row = await pool.fetchrow("SELECT * FROM tenants WHERE id = $1", ACME_ID)
    assert ACME_KEY not in [str(value) for value in row.values()]
    assert len(row["api_key_hash"]) == 64


async def test_internal_api_requires_the_admin_token(
    client: httpx.AsyncClient, acme: dict, admin: dict
) -> None:
    await send(client, acme)

    assert (await client.get("/internal/messages")).status_code == 401
    assert (await client.get("/internal/messages", headers={"X-Admin-Token": "wrong"})).status_code == 401
    # A tenant key is not an admin token.
    assert (await client.get("/internal/tenants", headers=acme)).status_code == 401

    everything = await client.get("/internal/messages", headers=admin)
    assert everything.status_code == 200
    assert everything.json()["data"][0]["tenant_name"] == "Acme Bank"


async def test_internal_send_goes_through_the_same_checks(
    client: httpx.AsyncClient, pool: asyncpg.Pool, admin: dict
) -> None:
    url = f"/internal/tenants/{ACME_ID}/messages"

    bad = await client.post(url, json=sms(to="12345"), headers=admin)
    assert bad.status_code == 422

    good = await client.post(url, json=sms(), headers=admin)
    assert good.status_code == 202
    detail = (await client.get(f"/internal/messages/{good.json()['id']}", headers=admin)).json()
    assert detail["message"]["status"] == "QUEUED"
    assert [entry["kind"] for entry in detail["ledger"]] == ["CHARGE"]
    assert set(detail) == {"message", "events", "attempts", "dlrs", "ledger", "webhooks"}
