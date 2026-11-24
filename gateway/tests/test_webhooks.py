"""Tenant webhooks: sent once per final state, retried with backoff, isolated per tenant."""

from __future__ import annotations

import json
from collections import deque

import asyncpg
import httpx
import pytest

from conftest import ACME_ID, SHOPFAST_ID, FakeCarrier, make_settings, post_dlr, send
from gateway.webhooks import WebhookWorker, webhook_signature


class FakeTenantEndpoint:
    def __init__(self) -> None:
        self.calls: list[httpx.Request] = []
        self._script: deque[int | str] = deque()

    def then(self, *steps: int | str) -> FakeTenantEndpoint:
        self._script.extend(steps)
        return self

    def _handle(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        step = self._script.popleft() if self._script else 200
        if step == "timeout":
            raise httpx.ReadTimeout("tenant endpoint is slow", request=request)
        return httpx.Response(int(step))

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)


@pytest.fixture
def endpoint() -> FakeTenantEndpoint:
    return FakeTenantEndpoint()


@pytest.fixture
async def webhook_worker(pool: asyncpg.Pool, endpoint: FakeTenantEndpoint):
    workers: list[WebhookWorker] = []

    def factory(**overrides) -> WebhookWorker:
        worker = WebhookWorker(pool=pool, settings=make_settings(**overrides), transport=endpoint.transport())
        workers.append(worker)
        return worker

    yield factory
    for worker in workers:
        await worker.aclose()


async def _delivered_message(client, pool, headers, carrier, make_dispatcher, carrier_id: str) -> str:
    message_id = await send(client, headers, client_ref="order-9")
    carrier.then(carrier_id)
    await make_dispatcher().run_once()
    await post_dlr(client, carrier_id, "DELIVRD")
    return message_id


async def _deliveries(pool: asyncpg.Pool) -> list[asyncpg.Record]:
    return await pool.fetch("SELECT * FROM webhook_deliveries ORDER BY created_at")


async def test_final_state_sends_one_signed_callback(
    client: httpx.AsyncClient,
    pool: asyncpg.Pool,
    acme: dict,
    carrier: FakeCarrier,
    make_dispatcher,
    endpoint: FakeTenantEndpoint,
    webhook_worker,
) -> None:
    await client.put("/v1/webhook", json={"callback_url": "https://acme.example/hooks/sms"}, headers=acme)
    message_id = await _delivered_message(client, pool, acme, carrier, make_dispatcher, "c-1")

    worker = webhook_worker()
    assert await worker.run_once() == 1
    assert await worker.run_once() == 0  # delivered: nothing left to send

    (call,) = endpoint.calls
    assert str(call.url) == "https://acme.example/hooks/sms"
    payload = json.loads(call.content)
    assert payload["type"] == "message.status"
    assert payload["message"]["id"] == message_id
    assert payload["message"]["status"] == "DELIVERED"
    assert payload["message"]["client_ref"] == "order-9"
    assert payload["id"] == call.headers["X-Webhook-Id"]
    # The tenant can verify the callback came from us.
    expected = webhook_signature(
        "whsec_acme_dev_secret", int(call.headers["X-Webhook-Timestamp"]), call.content
    )
    assert call.headers["X-Signature"] == expected

    (delivery,) = await _deliveries(pool)
    assert (delivery["status"], delivery["attempts"], delivery["last_http_status"]) == ("DELIVERED", 1, 200)


async def test_no_callback_url_means_no_webhook(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict, carrier: FakeCarrier, make_dispatcher
) -> None:
    await _delivered_message(client, pool, acme, carrier, make_dispatcher, "c-1")
    assert await _deliveries(pool) == []


async def test_failed_message_also_sends_a_callback(
    client: httpx.AsyncClient,
    pool: asyncpg.Pool,
    acme: dict,
    carrier: FakeCarrier,
    make_dispatcher,
    endpoint: FakeTenantEndpoint,
    webhook_worker,
) -> None:
    await client.put("/v1/webhook", json={"callback_url": "https://acme.example/hooks/sms"}, headers=acme)
    await send(client, acme)
    carrier.then(400)
    await make_dispatcher().run_once()

    await webhook_worker().run_once()

    payload = json.loads(endpoint.calls[0].content)
    assert payload["message"]["status"] == "FAILED"
    assert payload["message"]["failure_reason"] == "INVALID_DESTINATION"


async def test_a_failing_endpoint_is_retried_then_succeeds(
    client: httpx.AsyncClient,
    pool: asyncpg.Pool,
    acme: dict,
    carrier: FakeCarrier,
    make_dispatcher,
    endpoint: FakeTenantEndpoint,
    webhook_worker,
) -> None:
    await client.put("/v1/webhook", json={"callback_url": "https://acme.example/hooks/sms"}, headers=acme)
    await _delivered_message(client, pool, acme, carrier, make_dispatcher, "c-1")
    endpoint.then(500, "timeout", 200)
    worker = webhook_worker()

    for _ in range(3):
        await worker.run_once()

    (delivery,) = await _deliveries(pool)
    assert (delivery["status"], delivery["attempts"]) == ("DELIVERED", 3)
    # Every attempt carries the same delivery ID, so the tenant can de-duplicate.
    assert len({call.headers["X-Webhook-Id"] for call in endpoint.calls}) == 1


async def test_retry_is_scheduled_with_backoff(
    client: httpx.AsyncClient,
    pool: asyncpg.Pool,
    acme: dict,
    carrier: FakeCarrier,
    make_dispatcher,
    endpoint: FakeTenantEndpoint,
    webhook_worker,
) -> None:
    await client.put("/v1/webhook", json={"callback_url": "https://acme.example/hooks/sms"}, headers=acme)
    await _delivered_message(client, pool, acme, carrier, make_dispatcher, "c-1")
    endpoint.then(503)
    worker = webhook_worker(webhook_retry_base_seconds=60.0, webhook_retry_max_seconds=600.0)

    await worker.run_once()

    (delivery,) = await _deliveries(pool)
    wait = await pool.fetchval("SELECT EXTRACT(EPOCH FROM $1 - now())", delivery["next_attempt_at"])
    assert (delivery["status"], delivery["last_error"]) == ("PENDING", "HTTP 503")
    assert 29 <= wait <= 61
    assert await worker.run_once() == 0  # not due yet


async def test_gives_up_after_max_attempts(
    client: httpx.AsyncClient,
    pool: asyncpg.Pool,
    acme: dict,
    carrier: FakeCarrier,
    make_dispatcher,
    endpoint: FakeTenantEndpoint,
    webhook_worker,
) -> None:
    await client.put("/v1/webhook", json={"callback_url": "https://acme.example/hooks/sms"}, headers=acme)
    await _delivered_message(client, pool, acme, carrier, make_dispatcher, "c-1")
    endpoint.then(500, 500, 500, 500)
    worker = webhook_worker(webhook_max_attempts=3)

    for _ in range(5):
        await worker.run_once()

    (delivery,) = await _deliveries(pool)
    assert (delivery["status"], delivery["attempts"]) == ("DEAD", 3)
    assert len(endpoint.calls) == 3


async def test_a_backlog_for_one_tenant_does_not_starve_another(
    client: httpx.AsyncClient,
    pool: asyncpg.Pool,
    acme: dict,
    shopfast: dict,
    carrier: FakeCarrier,
    make_dispatcher,
    endpoint: FakeTenantEndpoint,
    webhook_worker,
) -> None:
    """ShopFast has 30 callbacks waiting, Acme has one that arrived last."""
    await client.put("/v1/webhook", json={"callback_url": "https://shop.example/hook"}, headers=shopfast)
    await client.put("/v1/webhook", json={"callback_url": "https://acme.example/hook"}, headers=acme)
    for i in range(30):
        await _delivered_message(client, pool, shopfast, carrier, make_dispatcher, f"c-shop-{i}")
    await _delivered_message(client, pool, acme, carrier, make_dispatcher, "c-acme")

    worker = webhook_worker(webhook_per_tenant_concurrency=4)
    started = await worker.run_once()

    # One round: four slots for ShopFast, and Acme's callback is in the same round.
    assert started == 5
    hosts = [call.url.host for call in endpoint.calls]
    assert hosts.count("shop.example") == 4 and hosts.count("acme.example") == 1
    by_tenant = await pool.fetch(
        "SELECT tenant_id, count(*) AS n FROM webhook_deliveries WHERE status = 'DELIVERED' GROUP BY 1"
    )
    assert {r["tenant_id"]: r["n"] for r in by_tenant} == {SHOPFAST_ID: 4, ACME_ID: 1}


async def test_callback_url_must_be_http(client: httpx.AsyncClient, acme: dict) -> None:
    for bad in ("ftp://example.com/x", "javascript:alert(1)", "not a url", "http://"):
        response = await client.put("/v1/webhook", json={"callback_url": bad}, headers=acme)
        assert response.status_code == 422, bad

    assert (await client.put("/v1/webhook", json={"callback_url": None}, headers=acme)).status_code == 200
    assert (await client.get("/v1/webhook", headers=acme)).json() == {"callback_url": None}
