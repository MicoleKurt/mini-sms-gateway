"""Delivery receipts from the carrier.

Three things can go wrong with a DLR and all three are normal:

  * it arrives twice                 -> the second one must do nothing;
  * it arrives before the carrier answered our submit, so we do not know its
    carrier_id yet                   -> keep it, apply it when the answer comes;
  * it arrives after the message is already final -> ignore it.

Both sides of the "early DLR" race (this module and the worker that records
the submit response) take the same advisory lock on the carrier_id before
they look for each other. Whoever comes second is guaranteed to see what the
first one committed, so the receipt cannot fall between the two.
"""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass, field
from datetime import datetime

import asyncpg

from gateway.lifecycle import finalize_from_dlr
from gateway.messages import StatusChange, iso
from gateway.status import DLR_STATUS


def sign(secret: str, raw_body: bytes) -> str:
    return hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()


def signature_is_valid(secret: str, raw_body: bytes, signature: str | None) -> bool:
    if not signature:
        return False
    expected = sign(secret, raw_body)
    # Constant-time compare, on bytes so a non-ASCII header cannot raise.
    return hmac.compare_digest(expected.encode("ascii"), signature.strip().lower().encode("utf-8"))


async def lock_carrier_id(conn: asyncpg.Connection, carrier_id: str) -> None:
    """Serialise everything that concerns one carrier_id until the transaction ends."""
    await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", carrier_id)


@dataclass(slots=True)
class DlrResult:
    #: "applied" | "pending" | "duplicate" | "ignored"
    result: str
    changes: list[StatusChange] = field(default_factory=list)


async def ingest(pool: asyncpg.Pool, carrier_id: str, status: str, carrier_timestamp: datetime) -> DlrResult:
    """Store one DLR and apply it if its message is known."""
    async with pool.acquire() as conn, conn.transaction():
        await lock_carrier_id(conn, carrier_id)
        receipt_id = await conn.fetchval(
            """
            INSERT INTO dlr_receipts (carrier_id, status, carrier_timestamp)
            VALUES ($1, $2, $3)
            ON CONFLICT (carrier_id, status) DO NOTHING
            RETURNING id
            """,
            carrier_id,
            status,
            carrier_timestamp,
        )
        if receipt_id is None:
            # Seen before. No row, no event, no webhook: no effect.
            return DlrResult("duplicate")
        return await _apply(conn, receipt_id, carrier_id, status, carrier_timestamp)


async def apply_pending(conn: asyncpg.Connection, carrier_id: str) -> list[StatusChange]:
    """Apply receipts that arrived before we knew this carrier_id.

    Called by the worker in the transaction that records the submit response.
    The caller already holds the advisory lock for `carrier_id`.
    """
    rows = await conn.fetch(
        """
        SELECT id, status, carrier_timestamp
        FROM dlr_receipts
        WHERE carrier_id = $1 AND disposition = 'PENDING'
        ORDER BY id
        """,
        carrier_id,
    )
    changes: list[StatusChange] = []
    for row in rows:
        result = await _apply(conn, row["id"], carrier_id, row["status"], row["carrier_timestamp"])
        changes.extend(result.changes)
    return changes


async def _apply(
    conn: asyncpg.Connection, receipt_id: int, carrier_id: str, status: str, carrier_timestamp: datetime
) -> DlrResult:
    message_id = await conn.fetchval(
        "SELECT message_id FROM submit_attempts WHERE carrier_id = $1", carrier_id
    )
    if message_id is None:
        # Either the submit response has not been recorded yet (it will pick
        # this row up), or it never will be (the submit timed out on our side).
        return DlrResult("pending")

    change = await finalize_from_dlr(
        conn,
        message_id,
        DLR_STATUS[status],
        detail={"carrier_id": carrier_id, "dlr_status": status, "carrier_timestamp": iso(carrier_timestamp)},
    )
    await conn.execute(
        """
        UPDATE dlr_receipts
        SET message_id = $2, disposition = $3, applied_at = clock_timestamp()
        WHERE id = $1
        """,
        receipt_id,
        message_id,
        "APPLIED" if change else "IGNORED",
    )
    if change is None:
        return DlrResult("ignored")
    return DlrResult("applied", [change])
