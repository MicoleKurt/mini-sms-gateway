"""Live updates for the dashboard: Redis pub/sub in, Server-Sent Events out.

The stream is a convenience, not a record. Events are published AFTER the
database commit and may be lost (a crash between the two, a slow browser);
the dashboard refetches when it reconnects. Nothing depends on the stream
for correctness, which is why a failure to publish is logged and ignored.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from gateway.messages import StatusChange

log = logging.getLogger(__name__)

CHANNEL = "smsgw:live"


class LivePublisher:
    def __init__(self, redis: Any, channel: str = CHANNEL, *, timeout_seconds: float = 0.25) -> None:
        self._redis = redis
        self._channel = channel
        self._timeout = timeout_seconds

    async def publish(self, event_type: str, payload: dict[str, Any]) -> None:
        message = json.dumps({"type": event_type, "data": payload})
        try:
            # Bounded: a Valkey that holds the connection without answering
            # would otherwise keep a committed send from getting its 202.
            await asyncio.wait_for(self._redis.publish(self._channel, message), timeout=self._timeout)
        except Exception:  # the stream must never break a request or a worker
            log.warning("could not publish live event %s", event_type, exc_info=True)

    async def publish_changes(self, changes: list[StatusChange]) -> None:
        for change in changes:
            await self.publish("message", change.to_event())

    async def publish_all(self, events: list[tuple[str, dict[str, Any]]]) -> None:
        for event_type, payload in events:
            await self.publish(event_type, payload)


def sse_frame(event_type: str, payload: dict[str, Any]) -> str:
    return f"event: {event_type}\ndata: {json.dumps(payload, separators=(',', ':'))}\n\n"


class LiveHub:
    """One Redis subscription per API process, fanned out to its SSE clients.

    Each client has a bounded queue. A browser that cannot keep up loses its
    oldest frames instead of growing memory in the API process.
    """

    QUEUE_SIZE = 2000

    def __init__(
        self,
        redis: Any,
        stats_provider: Callable[[], Awaitable[dict[str, Any]]],
        *,
        channel: str = CHANNEL,
        stats_interval: float = 1.0,
        ping_interval: float = 15.0,
    ) -> None:
        self._redis = redis
        self._channel = channel
        self._stats_provider = stats_provider
        self._stats_interval = stats_interval
        self._ping_interval = ping_interval
        self._clients: dict[asyncio.Queue[str], str | None] = {}
        self._tasks: list[asyncio.Task[None]] = []

    async def start(self) -> None:
        self._tasks = [
            asyncio.create_task(self._pump_redis(), name="live-redis"),
            asyncio.create_task(self._pump_stats(), name="live-stats"),
        ]

    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await task
        self._tasks = []

    async def stream(self, tenant_id: str | None) -> AsyncIterator[str]:
        """Frames for one client. Ends when the client disconnects (the generator is closed)."""
        queue: asyncio.Queue[str] = asyncio.Queue(maxsize=self.QUEUE_SIZE)
        self._clients[queue] = tenant_id
        try:
            # Tells the browser how long to wait before it reconnects.
            yield "retry: 2000\n\n"
            while True:
                try:
                    frame = await asyncio.wait_for(queue.get(), timeout=self._ping_interval)
                except TimeoutError:
                    frame = ": ping\n\n"
                yield frame
        finally:
            self._clients.pop(queue, None)

    def _broadcast(self, frame: str, tenant_id: str | None) -> None:
        for queue, wanted_tenant in self._clients.items():
            if wanted_tenant is not None and tenant_id is not None and wanted_tenant != tenant_id:
                continue
            if queue.full():
                with contextlib.suppress(asyncio.QueueEmpty):
                    queue.get_nowait()
            queue.put_nowait(frame)

    async def _pump_redis(self) -> None:
        while True:
            pubsub = self._redis.pubsub()
            try:
                await pubsub.subscribe(self._channel)
                async for item in pubsub.listen():
                    if item.get("type") != "message" or not self._clients:
                        continue
                    event = json.loads(item["data"])
                    data = event["data"]
                    self._broadcast(sse_frame(event["type"], data), data.get("tenant_id"))
            except asyncio.CancelledError:
                raise
            except Exception:
                log.warning("live subscription lost, reconnecting", exc_info=True)
                await asyncio.sleep(1.0)
            finally:
                with contextlib.suppress(Exception):
                    await pubsub.aclose()

    async def _pump_stats(self) -> None:
        while True:
            await asyncio.sleep(self._stats_interval)
            if not self._clients:
                continue
            try:
                stats = await self._stats_provider()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.warning("could not compute live stats", exc_info=True)
                continue
            self._broadcast(sse_frame("stats", stats), None)
