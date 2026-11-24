"""The live stream: what the API and the workers publish reaches a connected dashboard."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import asyncpg
import httpx

from conftest import FakeCarrier, make_settings, post_dlr, send
from gateway.live import LiveHub, LivePublisher

CHANNEL = make_settings().live_channel


async def _frames(hub: LiveHub, tenant_id: str | None, until: int) -> list[dict[str, Any]]:
    """Collect `until` events (comments and the retry hint are skipped). Gives up after 5 seconds."""
    events: list[dict[str, Any]] = []

    async def consume() -> None:
        async for frame in hub.stream(tenant_id):
            if not frame.startswith("event: "):
                continue
            header, data = frame.strip().split("\n", 1)
            events.append({"type": header.removeprefix("event: "), **json.loads(data.removeprefix("data: "))})
            if len(events) >= until:
                return

    await asyncio.wait_for(consume(), 5.0)
    return events


async def _hub(redis_client: Any) -> LiveHub:
    async def no_stats() -> dict[str, Any]:
        return {}

    hub = LiveHub(redis_client, no_stats, channel=CHANNEL, stats_interval=3600)
    await hub.start()
    await asyncio.sleep(0.1)  # let the subscription reach the server
    return hub


async def test_every_status_change_of_a_message_reaches_the_stream(
    client: httpx.AsyncClient,
    pool: asyncpg.Pool,
    redis_client: Any,
    acme: dict,
    carrier: FakeCarrier,
    make_dispatcher,
) -> None:
    hub = await _hub(redis_client)
    try:
        listener = asyncio.create_task(_frames(hub, None, until=3))
        await asyncio.sleep(0.05)

        message_id = await send(client, acme)  # published by the API
        carrier.then("c-live")
        await make_dispatcher().run_once()  # published by the worker
        await post_dlr(client, "c-live", "DELIVRD")  # published by the DLR endpoint

        events = await listener
    finally:
        await hub.stop()

    assert [(e["type"], e["id"], e["status"]) for e in events] == [
        ("message", message_id, "QUEUED"),
        ("message", message_id, "SUBMITTED"),
        ("message", message_id, "DELIVERED"),
    ]
    # Each event carries the whole message, so a list row can be drawn from it.
    assert events[-1]["message"]["tenant_name"] == "Acme Bank"
    assert events[-1]["message"]["carrier_id"] == "c-live"


async def test_a_batch_is_one_event_not_a_thousand(
    client: httpx.AsyncClient, redis_client: Any, acme: dict
) -> None:
    from conftest import sms

    hub = await _hub(redis_client)
    try:
        listener = asyncio.create_task(_frames(hub, None, until=1))
        await asyncio.sleep(0.05)
        response = await client.post("/v1/messages/batch", json={"messages": [sms()] * 300}, headers=acme)
        events = await listener
    finally:
        await hub.stop()

    assert events == [
        {
            "type": "batch",
            "batch_id": response.json()["batch_id"],
            "tenant_id": events[0]["tenant_id"],
            "count": 300,
            "occurred_at": response.json()["created_at"],
        }
    ]


async def test_a_stream_filtered_by_tenant_gets_only_that_tenant(redis_client: Any) -> None:
    hub = await _hub(redis_client)
    publisher = LivePublisher(redis_client, CHANNEL)
    try:
        listener = asyncio.create_task(_frames(hub, "tenant-b", until=1))
        await asyncio.sleep(0.05)
        await publisher.publish("message", {"id": "1", "tenant_id": "tenant-a", "status": "QUEUED"})
        await publisher.publish("message", {"id": "2", "tenant_id": "tenant-b", "status": "QUEUED"})
        events = await listener
    finally:
        await hub.stop()

    assert [e["id"] for e in events] == ["2"]


async def test_a_client_that_does_not_read_loses_old_events_not_memory(redis_client: Any) -> None:
    hub = await _hub(redis_client)
    publisher = LivePublisher(redis_client, CHANNEL)
    try:
        stream = hub.stream(None)
        assert (await anext(stream)).startswith("retry:")  # connected, and now it stops reading
        for i in range(LiveHub.QUEUE_SIZE + 50):
            await publisher.publish("message", {"id": str(i), "tenant_id": "t", "status": "QUEUED"})
        await asyncio.sleep(0.3)

        (queue,) = hub._clients
        assert queue.qsize() == LiveHub.QUEUE_SIZE  # bounded
        first = json.loads((await anext(stream)).split("data: ", 1)[1])
        assert first["id"] == "50"  # the oldest 50 were dropped
        await stream.aclose()
    finally:
        await hub.stop()


async def test_a_redis_outage_does_not_fail_a_send(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict
) -> None:
    """The stream is a convenience. If publishing fails, the message is still accepted."""

    async def broken_publish(*_args: Any, **_kwargs: Any) -> None:
        raise ConnectionError("valkey is down")

    app = client._transport.app  # type: ignore[attr-defined]
    app.state.publisher._redis.publish = broken_publish

    message_id = await send(client, acme)

    assert await pool.fetchval("SELECT status FROM messages WHERE id = $1::uuid", message_id) == "QUEUED"


async def test_a_valkey_that_never_answers_does_not_hold_up_a_send(pool: asyncpg.Pool, acme: dict) -> None:
    """Valkey accepts the connection and then says nothing, like a paused
    container. The send is committed and must still get its 202 at once."""
    from gateway.api.app import create_app

    connections: list[asyncio.StreamWriter] = []

    async def silent(_reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        connections.append(writer)

    server = await asyncio.start_server(silent, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    app = create_app(make_settings(redis_url=f"redis://127.0.0.1:{port}/0"), pool=pool)
    try:
        async with app.router.lifespan_context(app):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://gateway") as http:
                started = asyncio.get_running_loop().time()
                message_id = await asyncio.wait_for(send(http, acme), timeout=5.0)
                elapsed = asyncio.get_running_loop().time() - started
    finally:
        for writer in connections:
            writer.close()
        server.close()

    assert elapsed < 1.0
    assert await pool.fetchval("SELECT status FROM messages WHERE id = $1::uuid", message_id) == "QUEUED"


async def test_a_publish_that_never_returns_is_given_up(
    client: httpx.AsyncClient, pool: asyncpg.Pool, acme: dict
) -> None:
    async def hanging_publish(*_args: Any, **_kwargs: Any) -> None:
        await asyncio.Event().wait()

    app = client._transport.app  # type: ignore[attr-defined]
    app.state.publisher._redis.publish = hanging_publish

    message_id = await asyncio.wait_for(send(client, acme), timeout=5.0)

    assert await pool.fetchval("SELECT status FROM messages WHERE id = $1::uuid", message_id) == "QUEUED"


def test_every_command_client_has_socket_timeouts() -> None:
    from gateway.valkey import connect, connect_subscriber

    kwargs = connect("redis://valkey:6379/0", timeout_seconds=1.5).connection_pool.connection_kwargs
    assert (kwargs["socket_timeout"], kwargs["socket_connect_timeout"]) == (1.5, 1.5)
    subscriber = connect_subscriber("redis://valkey:6379/0", timeout_seconds=1.5)
    assert subscriber.connection_pool.connection_kwargs["socket_connect_timeout"] == 1.5


async def test_metrics_report_the_queue_as_it_is_at_scrape_time(
    client: httpx.AsyncClient, acme: dict
) -> None:
    """No dashboard is connected, so nothing else refreshes the gauges."""
    from conftest import sms

    await client.post("/v1/messages/batch", json={"messages": [sms()] * 3}, headers=acme)

    text = (await client.get("/metrics")).text

    assert "smsgw_queue_depth 3.0" in text


def test_a_worker_metrics_endpoint_does_not_export_the_queue_gauges() -> None:
    """A worker serves the default registry and never refreshes the queue
    gauges, so it must not report them as a constant 0."""
    from prometheus_client import generate_latest

    text = generate_latest().decode()

    assert "smsgw_queue_depth" not in text
    assert "smsgw_submits_in_flight" not in text
