"""Expire messages whose delivery receipt never came.

The carrier sends a DLR for every message it accepted, but a receipt can be
lost: the carrier gives up resending, or the gateway was down while it tried.
Without this sweep such a message would stay SUBMITTED for ever. After
`dlr_wait_seconds` (the carrier's validity period) it becomes EXPIRED with
reason NO_DLR. The charge is kept: the carrier accepted the message and bills
for it.

A DLR that arrives afterwards finds the message final and is stored as
IGNORED, by the same compare-and-set as any other late DLR.

Safe in several processes: a batch locks its rows with SKIP LOCKED, so two
sweepers never take the same message and never wait on each other.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from datetime import timedelta

import asyncpg

from gateway import metrics
from gateway.config import Settings
from gateway.lifecycle import finalize_from_dlr
from gateway.messages import StatusChange
from gateway.status import EXPIRED

log = logging.getLogger(__name__)

NO_DLR = "NO_DLR"

_DUE = """
SELECT id
FROM messages
WHERE status = 'SUBMITTED' AND submitted_at < now() - $1::interval
ORDER BY submitted_at
LIMIT $2
FOR UPDATE SKIP LOCKED
"""


async def expire_batch(pool: asyncpg.Pool, *, wait_seconds: float, batch_size: int) -> list[StatusChange]:
    """Expire up to `batch_size` overdue messages in one transaction."""
    async with pool.acquire() as conn, conn.transaction():
        rows = await conn.fetch(_DUE, timedelta(seconds=wait_seconds), batch_size)
        changes = []
        for row in rows:
            change = await finalize_from_dlr(
                conn, row["id"], EXPIRED, detail={"reason": NO_DLR}, failure_reason=NO_DLR
            )
            if change is not None:
                changes.append(change)
        return changes


async def sweep(pool: asyncpg.Pool, *, wait_seconds: float, batch_size: int) -> int:
    """Expire every overdue message, batch by batch. Return how many were expired."""
    total = 0
    while True:
        changes = await expire_batch(pool, wait_seconds=wait_seconds, batch_size=batch_size)
        total += len(changes)
        metrics.MESSAGES_FINAL.labels(EXPIRED).inc(len(changes))
        metrics.EXPIRED_WITHOUT_DLR.inc(len(changes))
        if len(changes) < batch_size:
            return total


class DlrSweeper:
    def __init__(self, *, pool: asyncpg.Pool, settings: Settings) -> None:
        self._pool = pool
        self._settings = settings

    async def run(self, stop: asyncio.Event) -> None:
        settings = self._settings
        log.info(
            "DLR sweep started: SUBMITTED for more than %.0f s becomes EXPIRED", settings.dlr_wait_seconds
        )
        while not stop.is_set():
            try:
                expired = await sweep(
                    self._pool,
                    wait_seconds=settings.dlr_wait_seconds,
                    batch_size=settings.dlr_sweep_batch_size,
                )
                if expired:
                    log.warning("expired %d messages that got no DLR in time", expired)
            except Exception:
                log.exception("DLR sweep failed")
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(stop.wait(), timeout=settings.dlr_sweep_interval_seconds)
