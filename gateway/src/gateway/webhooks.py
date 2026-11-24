"""Tenant webhooks: deliver the outbox rows written by `lifecycle.enqueue_webhook`.

Runs as its own process with its own connection pool and HTTP client, so a
tenant endpoint that is slow or down cannot take anything away from the
dispatcher. Inside this worker, each tenant gets a fixed number of
concurrent deliveries, so one broken endpoint cannot starve the callbacks of
the other tenants either.

Delivery is at-least-once: a crash after the tenant answered 200 but before
we recorded it sends the same payload again. The payload `id` is stable, so
the tenant can drop repeats.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import hmac
import json
import logging
import time
import uuid
from datetime import timedelta
from typing import Any
from urllib.parse import urlsplit

import asyncpg
import httpx

from gateway import metrics
from gateway.config import Settings
from gateway.messages import iso
from gateway.retry import backoff_seconds

log = logging.getLogger(__name__)

MAX_URL_LENGTH = 2048


def is_valid_callback_url(url: str) -> bool:
    if len(url) > MAX_URL_LENGTH:
        return False
    parts = urlsplit(url)
    return parts.scheme in ("http", "https") and bool(parts.hostname)


def webhook_signature(secret: str, timestamp: int, body: bytes) -> str:
    return hmac.new(
        secret.encode("utf-8"), f"{timestamp}.".encode("ascii") + body, hashlib.sha256
    ).hexdigest()


# For each tenant with free slots, lock up to that many due deliveries and
# push their next_attempt_at forward by the lease (same visibility-timeout
# pattern as the message queue).
_CLAIM = """
WITH due AS (
    SELECT d.id
    FROM unnest($1::uuid[], $2::int[]) AS slot(tenant_id, free)
    CROSS JOIN LATERAL (
        SELECT w.id
        FROM webhook_deliveries w
        WHERE w.tenant_id = slot.tenant_id
          AND w.status = 'PENDING'
          AND w.next_attempt_at <= now()
        ORDER BY w.next_attempt_at
        LIMIT slot.free
        FOR UPDATE OF w SKIP LOCKED
    ) d
)
UPDATE webhook_deliveries w
SET attempts = w.attempts + 1,
    next_attempt_at = now() + $3::interval
FROM due, tenants t
WHERE w.id = due.id AND t.id = w.tenant_id
RETURNING w.id, w.tenant_id, w.url, w.payload, w.attempts, t.webhook_secret
"""


class WebhookWorker:
    TENANT_REFRESH_SECONDS = 5.0

    def __init__(
        self,
        *,
        pool: asyncpg.Pool,
        settings: Settings,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._pool = pool
        self._settings = settings
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(settings.webhook_timeout_seconds),
            follow_redirects=False,
            transport=transport,
        )
        self._tasks: set[asyncio.Task[None]] = set()
        self._in_flight: dict[uuid.UUID, int] = {}
        self._tenants: list[uuid.UUID] = []
        self._tenants_loaded_at = float("-inf")

    async def aclose(self) -> None:
        await self._client.aclose()

    async def run(self, stop: asyncio.Event) -> None:
        log.info("webhook worker started")
        while not stop.is_set():
            try:
                pause = await self._tick()
            except Exception:
                log.exception("webhook tick failed")
                pause = 1.0
            if pause > 0:
                with contextlib.suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(stop.wait(), timeout=pause)
        if self._tasks:
            await asyncio.wait(self._tasks, timeout=self._settings.webhook_timeout_seconds + 1)

    async def run_once(self) -> int:
        """Claim and finish one round of deliveries. Used by the tests."""
        self._tenants_loaded_at = float("-inf")
        await self._tick()
        tasks = list(self._tasks)
        if tasks:
            await asyncio.gather(*tasks)
        return len(tasks)

    async def _tick(self) -> float:
        await self._refresh_tenants()
        cap = self._settings.webhook_per_tenant_concurrency
        slots = {t: cap - self._in_flight.get(t, 0) for t in self._tenants}
        slots = {t: free for t, free in slots.items() if free > 0}

        rows = []
        if slots:
            rows = await self._pool.fetch(
                _CLAIM,
                list(slots.keys()),
                list(slots.values()),
                timedelta(seconds=self._settings.webhook_lease_seconds),
            )
        for row in rows:
            self._spawn(row)
        if rows:
            return 0.0
        if self._tasks:
            # Nothing new to start. Wake up when a slot frees or after the poll interval.
            await asyncio.wait(
                self._tasks,
                timeout=self._settings.webhook_idle_poll_seconds,
                return_when=asyncio.FIRST_COMPLETED,
            )
            return 0.0
        return self._settings.webhook_idle_poll_seconds

    async def _refresh_tenants(self) -> None:
        now = time.monotonic()
        if now - self._tenants_loaded_at < self.TENANT_REFRESH_SECONDS:
            return
        rows = await self._pool.fetch("SELECT id FROM tenants")
        self._tenants = [r["id"] for r in rows]
        self._tenants_loaded_at = now

    def _spawn(self, row: asyncpg.Record) -> None:
        tenant_id = row["tenant_id"]
        self._in_flight[tenant_id] = self._in_flight.get(tenant_id, 0) + 1
        task = asyncio.create_task(self._deliver_safely(row), name=f"webhook-{row['id']}")
        self._tasks.add(task)

        def _done(finished: asyncio.Task[None]) -> None:
            self._tasks.discard(finished)
            self._in_flight[tenant_id] -= 1

        task.add_done_callback(_done)

    async def _deliver_safely(self, row: asyncpg.Record) -> None:
        try:
            await self._deliver(row)
        except Exception:
            # Not recorded: the lease expires and the delivery is tried again.
            log.exception("webhook delivery %s was not recorded", row["id"])

    async def _deliver(self, row: asyncpg.Record) -> None:
        body = json.dumps(row["payload"], separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        timestamp = int(time.time())
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "sms-gateway-webhook/1",
            "X-Webhook-Id": str(row["id"]),
            "X-Webhook-Timestamp": str(timestamp),
        }
        if row["webhook_secret"]:
            headers["X-Signature"] = webhook_signature(row["webhook_secret"], timestamp, body)

        http_status: int | None = None
        error: str | None = None
        try:
            response = await self._client.post(row["url"], content=body, headers=headers)
            http_status = response.status_code
            if not 200 <= http_status < 300:
                error = f"HTTP {http_status}"
        except httpx.HTTPError as exc:
            error = f"{type(exc).__name__}: {exc}"[:500]

        if error is None:
            metrics.WEBHOOK_DELIVERIES.labels("delivered").inc()
            await self._pool.execute(
                """
                UPDATE webhook_deliveries
                SET status = 'DELIVERED', delivered_at = clock_timestamp(),
                    last_http_status = $2, last_error = NULL
                WHERE id = $1 AND status = 'PENDING'
                """,
                row["id"],
                http_status,
            )
            return

        settings = self._settings
        exhausted = row["attempts"] >= settings.webhook_max_attempts
        metrics.WEBHOOK_DELIVERIES.labels("dead" if exhausted else "retry").inc()
        delay = backoff_seconds(
            row["attempts"], settings.webhook_retry_base_seconds, settings.webhook_retry_max_seconds
        )
        await self._pool.execute(
            """
            UPDATE webhook_deliveries
            SET status = CASE WHEN $2 THEN 'DEAD' ELSE 'PENDING' END,
                next_attempt_at = now() + $3::interval,
                last_http_status = $4,
                last_error = $5
            WHERE id = $1 AND status = 'PENDING'
            """,
            row["id"],
            exhausted,
            timedelta(seconds=delay),
            http_status,
            error,
        )


def webhook_json(row: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "url": row["url"],
        "status": row["status"],
        "attempts": row["attempts"],
        "last_http_status": row["last_http_status"],
        "last_error": row["last_error"],
        "created_at": iso(row["created_at"]),
        "delivered_at": iso(row["delivered_at"]),
        "next_attempt_at": iso(row["next_attempt_at"]),
    }
