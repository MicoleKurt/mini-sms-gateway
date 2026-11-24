import time
from collections.abc import AsyncIterator
from datetime import datetime

import httpx
import pytest

from mock_carrier.config import SinkConfig
from mock_carrier.sink import create_app

ENV = {
    "SINK_FAIL_SHOPFAST": "1",
    "SINK_DELAY_MS_ACME_BANK": "100-100",
}
WEBHOOK = {"id": "d-1", "type": "message.status", "message": {"id": "m-1", "status": "DELIVERED"}}


@pytest.fixture
async def sink() -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(SinkConfig.from_env(ENV))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://sink.test"
    ) as client:
        yield client


async def test_hook_is_recorded_and_answered_200(sink: httpx.AsyncClient) -> None:
    response = await sink.post("/hooks/quiet-tenant", json=WEBHOOK)

    assert response.status_code == 200
    stats = (await sink.get("/stats")).json()
    assert stats["tenants"]["quiet-tenant"]["received"] == 1
    assert stats["tenants"]["quiet-tenant"]["failed"] == 0
    datetime.fromisoformat(stats["tenants"]["quiet-tenant"]["last_received_at"])


async def test_fail_share_returns_500_for_that_tenant_only(sink: httpx.AsyncClient) -> None:
    failing = [await sink.post("/hooks/shopfast", json=WEBHOOK) for _ in range(3)]
    healthy = [await sink.post("/hooks/quiet-tenant", json=WEBHOOK) for _ in range(2)]

    assert [response.status_code for response in failing] == [500, 500, 500]
    assert [response.status_code for response in healthy] == [200, 200]
    stats = (await sink.get("/stats")).json()
    assert stats["tenants"]["shopfast"]["received"] == 3
    assert stats["tenants"]["shopfast"]["failed"] == 3
    assert stats["tenants"]["quiet-tenant"]["received"] == 2
    assert stats["tenants"]["quiet-tenant"]["failed"] == 0


async def test_delay_is_applied_to_the_slug_with_a_dash(sink: httpx.AsyncClient) -> None:
    started = time.perf_counter()
    response = await sink.post("/hooks/acme-bank", json=WEBHOOK)
    elapsed = time.perf_counter() - started

    assert response.status_code == 200
    # Loose bound: the event loop clock on Windows ticks every 15 ms or so.
    assert elapsed >= 0.07


async def test_stats_start_empty_and_nothing_is_verified(sink: httpx.AsyncClient) -> None:
    empty = (await sink.get("/stats")).json()
    unsigned = await sink.post("/hooks/quiet-tenant", content=b"not json")

    assert empty == {"tenants": {}}
    assert unsigned.status_code == 200


async def test_healthz(sink: httpx.AsyncClient) -> None:
    response = await sink.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
