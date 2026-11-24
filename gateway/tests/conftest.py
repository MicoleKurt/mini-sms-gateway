"""Test fixtures.

The tests run against a real PostgreSQL: the properties under test (row locks,
SKIP LOCKED, unique indexes, CHECK constraints) only exist there. Set
TEST_DATABASE_URL to a database whose name ends in "_test"; it is wiped
between tests.

Redis: TEST_REDIS_URL if set (CI uses a real Valkey), otherwise an in-process
fake that runs the same Lua scripts.
"""

from __future__ import annotations

import json
import os
from collections import deque
from collections.abc import AsyncIterator, Callable
from typing import Any

import asyncpg
import httpx
import pytest

from gateway import dlr
from gateway.api.app import create_app
from gateway.carrier import CarrierClient
from gateway.config import Settings
from gateway.db import create_pool
from gateway.dispatch import Dispatcher
from gateway.limiter import RateLimiter
from gateway.live import LivePublisher
from gateway.migrate import migrate
from gateway.seed import ACME_ID, SHOPFAST_ID, seed

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "postgresql://smsgw:smsgw@localhost:5432/smsgw_test")
TEST_REDIS_URL = os.environ.get("TEST_REDIS_URL")

ACME_KEY = "sk_acme_test_key"
SHOPFAST_KEY = "sk_shop_test_key"
ADMIN_TOKEN = "test-admin-token"
DLR_SECRET = "test-dlr-secret"

BD_NUMBER = "+8801711000001"  # priced at 4,000 micros per segment
BD_PRICE = 4_000

_TABLES = (
    "webhook_deliveries, idempotency_keys, ledger_entries, dlr_receipts, submit_attempts, "
    "message_events, messages, prices, dispatch_cursor, tenants"
)


def make_settings(**overrides: Any) -> Settings:
    """Settings for tests: no backoff waits, and a rate limit high enough not to matter."""
    values: dict[str, Any] = {
        "database_url": TEST_DATABASE_URL,
        "dlr_secret": DLR_SECRET,
        "admin_token": ADMIN_TOKEN,
        "live_channel": "smsgw:test:live",
        "seed_acme_api_key": ACME_KEY,
        "seed_shopfast_api_key": SHOPFAST_KEY,
        "seed_acme_callback_url": None,
        "seed_shopfast_callback_url": None,
        "carrier_rate_limit": 100_000,
        "carrier_rate_headroom": 1.0,
        "carrier_burst": 8,
        "carrier_429_penalty_seconds": 0.0,
        "retry_base_seconds": 0.0,
        "retry_max_seconds": 0.0,
        "worker_idle_poll_seconds": 0.0,
        "webhook_retry_base_seconds": 0.0,
        "webhook_retry_max_seconds": 0.0,
        "price_cache_seconds": 0.0,
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


@pytest.fixture(scope="session")
async def _database() -> AsyncIterator[asyncpg.Pool]:
    name = TEST_DATABASE_URL.rsplit("/", 1)[-1].split("?", 1)[0]
    if not name.endswith("_test"):
        pytest.exit(f"refusing to run: database {name!r} does not end in '_test' and would be wiped", 2)
    await migrate(TEST_DATABASE_URL)
    pool = await create_pool(TEST_DATABASE_URL, min_size=2, max_size=20)
    yield pool
    await pool.close()


@pytest.fixture
def settings() -> Settings:
    return make_settings()


@pytest.fixture
async def pool(_database: asyncpg.Pool, settings: Settings) -> asyncpg.Pool:
    """A clean database with the two seeded tenants and the price table."""
    async with _database.acquire() as conn:
        await conn.execute(f"TRUNCATE {_TABLES} RESTART IDENTITY CASCADE")
        await seed(conn, settings)
    return _database


@pytest.fixture
async def redis_client() -> AsyncIterator[Any]:
    if TEST_REDIS_URL:
        import redis.asyncio as aioredis

        client = aioredis.from_url(TEST_REDIS_URL, decode_responses=True)
    else:
        import fakeredis

        client = fakeredis.FakeAsyncRedis(decode_responses=True)
    await client.flushdb()
    yield client
    await client.aclose()


@pytest.fixture
async def client(
    pool: asyncpg.Pool, redis_client: Any, settings: Settings
) -> AsyncIterator[httpx.AsyncClient]:
    """An HTTP client wired straight into the ASGI app (no network)."""
    app = create_app(settings, pool=pool, redis_client=redis_client)
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://gateway") as http:
            yield http


@pytest.fixture
def acme() -> dict[str, str]:
    return {"X-API-Key": ACME_KEY}


@pytest.fixture
def shopfast() -> dict[str, str]:
    return {"X-API-Key": SHOPFAST_KEY}


@pytest.fixture
def admin() -> dict[str, str]:
    return {"X-Admin-Token": ADMIN_TOKEN}


class FakeCarrier:
    """A scripted carrier. Each submit takes the next step of the script; when
    the script is empty the carrier accepts.

    Steps: an int (HTTP status), "timeout", or a str carrier_id to accept with.
    """

    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self._script: deque[int | str] = deque()
        self._accepted = 0

    def then(self, *steps: int | str) -> FakeCarrier:
        self._script.extend(steps)
        return self

    def _handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(json.loads(request.content))
        step = self._script.popleft() if self._script else 200
        if step == "timeout":
            raise httpx.ReadTimeout("carrier did not answer", request=request)
        if isinstance(step, str):
            return httpx.Response(200, json={"carrier_id": step})
        if step == 200:
            self._accepted += 1
            return httpx.Response(200, json={"carrier_id": f"c-test-{self._accepted}"})
        errors = {400: "INVALID_DESTINATION", 429: "RATE_LIMITED", 503: "TEMPORARY_FAILURE"}
        return httpx.Response(step, json={"error": errors.get(step, "ERROR")})

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)


@pytest.fixture
def carrier() -> FakeCarrier:
    return FakeCarrier()


@pytest.fixture
async def make_dispatcher(
    pool: asyncpg.Pool, redis_client: Any, carrier: FakeCarrier
) -> AsyncIterator[Callable[..., Dispatcher]]:
    clients: list[CarrierClient] = []

    def factory(settings: Settings | None = None, worker_id: str = "w-test") -> Dispatcher:
        settings = settings or make_settings()
        carrier_client = CarrierClient("http://carrier", timeout_seconds=1.0, transport=carrier.transport())
        clients.append(carrier_client)
        limiter = RateLimiter(
            redis_client, rate_per_second=settings.carrier_target_rate, burst=settings.carrier_burst
        )
        return Dispatcher(
            pool=pool,
            limiter=limiter,
            carrier=carrier_client,
            publisher=LivePublisher(redis_client, settings.live_channel),
            settings=settings,
            worker_id=worker_id,
        )

    yield factory
    for carrier_client in clients:
        await carrier_client.aclose()


# --- helpers -------------------------------------------------------------------


def sms(to: str = BD_NUMBER, text: str = "Your code is 482913", **extra: Any) -> dict[str, Any]:
    return {"to": to, "from": "ACME", "text": text, **extra}


async def send(http: httpx.AsyncClient, headers: dict[str, str], **kwargs: Any) -> str:
    """Send one message and return its ID."""
    response = await http.post("/v1/messages", json=sms(**kwargs), headers=headers)
    assert response.status_code == 202, response.text
    return response.json()["id"]


async def post_dlr(
    http: httpx.AsyncClient,
    carrier_id: str,
    status: str = "DELIVRD",
    *,
    signature: str | None = "valid",
    timestamp: str = "2026-11-24T10:00:00Z",
) -> httpx.Response:
    raw = json.dumps({"carrier_id": carrier_id, "status": status, "timestamp": timestamp}).encode()
    headers = {"Content-Type": "application/json"}
    if signature == "valid":
        headers["X-Signature"] = dlr.sign(DLR_SECRET, raw)
    elif signature is not None:
        headers["X-Signature"] = signature
    return await http.post("/carrier/dlr", content=raw, headers=headers)


async def message_row(pool: asyncpg.Pool, message_id: str) -> asyncpg.Record:
    return await pool.fetchrow("SELECT * FROM messages WHERE id = $1::uuid", message_id)


async def event_statuses(pool: asyncpg.Pool, message_id: str) -> list[str]:
    rows = await pool.fetch(
        "SELECT status FROM message_events WHERE message_id = $1::uuid ORDER BY id", message_id
    )
    return [r["status"] for r in rows]


async def balance_of(pool: asyncpg.Pool, tenant_id: Any) -> int:
    return await pool.fetchval("SELECT balance_micros FROM tenants WHERE id = $1", tenant_id)


async def ledger_of(pool: asyncpg.Pool, message_id: str) -> list[tuple[str, int]]:
    rows = await pool.fetch(
        "SELECT kind, amount_micros FROM ledger_entries WHERE message_id = $1::uuid ORDER BY id", message_id
    )
    return [(r["kind"], r["amount_micros"]) for r in rows]


async def assert_books_balance(pool: asyncpg.Pool) -> None:
    """The billing invariant, for every tenant."""
    rows = await pool.fetch(
        """
        SELECT t.slug, t.balance_micros, t.opening_balance_micros,
               COALESCE((SELECT SUM(l.amount_micros) FROM ledger_entries l
                         WHERE l.tenant_id = t.id), 0) AS ledger
        FROM tenants t
        """
    )
    for row in rows:
        assert row["balance_micros"] >= 0, row["slug"]
        assert row["balance_micros"] == row["opening_balance_micros"] - row["ledger"], row["slug"]


__all__ = [
    "ACME_ID",
    "ACME_KEY",
    "BD_NUMBER",
    "BD_PRICE",
    "DLR_SECRET",
    "SHOPFAST_ID",
    "SHOPFAST_KEY",
    "FakeCarrier",
    "assert_books_balance",
    "balance_of",
    "event_statuses",
    "ledger_of",
    "make_settings",
    "message_row",
    "post_dlr",
    "send",
    "sms",
]
