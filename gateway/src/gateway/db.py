"""PostgreSQL connection pool."""

from __future__ import annotations

import asyncio
import json
import logging

import asyncpg

log = logging.getLogger(__name__)


async def _init_connection(conn: asyncpg.Connection) -> None:
    # jsonb columns travel as Python objects instead of strings.
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


async def create_pool(dsn: str, *, min_size: int = 2, max_size: int = 12) -> asyncpg.Pool:
    return await asyncpg.create_pool(dsn, min_size=min_size, max_size=max_size, init=_init_connection)


async def wait_for_database(dsn: str, *, attempts: int = 60, delay: float = 1.0) -> None:
    """Block until the database accepts connections (used at container start)."""
    for attempt in range(1, attempts + 1):
        try:
            conn = await asyncpg.connect(dsn, timeout=5)
        except (TimeoutError, OSError, asyncpg.PostgresError) as exc:
            if attempt == attempts:
                raise
            log.info("database not ready (%s), retrying", exc.__class__.__name__)
            await asyncio.sleep(delay)
        else:
            await conn.close()
            return
