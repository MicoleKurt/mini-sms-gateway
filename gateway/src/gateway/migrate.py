"""Apply SQL migrations, then (optionally) the seed data.

    python -m gateway.migrate           # migrations only
    python -m gateway.migrate --seed    # migrations + seed

Migrations are plain, numbered .sql files in `migrations/`, applied in order,
each in its own transaction, forward only. There is no ORM in this project,
so there is nothing to auto-generate: the SQL file is the schema, and a
reviewer can read it top to bottom.

Safety:
  * an advisory lock makes concurrent runners wait instead of racing;
  * a checksum per applied file refuses to continue if history was edited.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import logging
import os
from pathlib import Path

import asyncpg

from gateway.config import Settings, get_settings
from gateway.db import wait_for_database
from gateway.seed import seed

log = logging.getLogger("gateway.migrate")

_LOCK_KEY = 7_316_042_001  # arbitrary, constant: "the migration lock"


def migrations_dir() -> Path:
    override = os.environ.get("MIGRATIONS_DIR")
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[2] / "migrations"


async def migrate(dsn: str, directory: Path | None = None) -> list[str]:
    """Apply every migration that has not been applied. Return the versions applied now."""
    directory = directory or migrations_dir()
    files = sorted(directory.glob("*.sql"))
    if not files:
        raise RuntimeError(f"no migrations found in {directory}")

    applied_now: list[str] = []
    conn = await asyncpg.connect(dsn)
    try:
        await conn.execute("SELECT pg_advisory_lock($1)", _LOCK_KEY)
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version     text PRIMARY KEY,
                checksum    text NOT NULL,
                applied_at  timestamptz NOT NULL DEFAULT now()
            )
            """
        )
        applied = {r["version"]: r["checksum"] for r in await conn.fetch("SELECT * FROM schema_migrations")}
        for path in files:
            version = path.stem
            # Normalise line endings so a Windows checkout has the same checksum.
            sql = path.read_text(encoding="utf-8").replace("\r\n", "\n")
            checksum = hashlib.sha256(sql.encode("utf-8")).hexdigest()
            if version in applied:
                if applied[version] != checksum:
                    raise RuntimeError(
                        f"migration {version} was changed after it was applied; add a new migration instead"
                    )
                continue
            async with conn.transaction():
                await conn.execute(sql)
                await conn.execute(
                    "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", version, checksum
                )
            applied_now.append(version)
            log.info("applied %s", version)
    finally:
        await conn.execute("SELECT pg_advisory_unlock($1)", _LOCK_KEY)
        await conn.close()
    return applied_now


async def main(settings: Settings, *, with_seed: bool) -> None:
    await wait_for_database(settings.database_url)
    applied = await migrate(settings.database_url)
    log.info("migrations up to date (%d applied now)", len(applied))
    if with_seed:
        conn = await asyncpg.connect(settings.database_url)
        try:
            await seed(conn, settings)
        finally:
            await conn.close()
        log.info("seed data present")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--seed", action="store_true", help="also insert the demo tenants and prices")
    args = parser.parse_args()
    logging.basicConfig(level="INFO", format="%(asctime)s %(levelname)s %(name)s %(message)s")
    asyncio.run(main(get_settings(), with_seed=args.seed))
