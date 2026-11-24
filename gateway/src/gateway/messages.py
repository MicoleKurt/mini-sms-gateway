"""Message rows: JSON shape, and the single function that changes a status."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import asyncpg

from gateway.status import ALLOWED, FINAL_STATUSES

#: Every read of a message goes through this SELECT so the JSON shape has one source.
SELECT_MESSAGE = """
    SELECT m.*, t.name AS tenant_name, t.currency
    FROM messages m
    JOIN tenants t ON t.id = m.tenant_id
"""


def iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def message_json(row: asyncpg.Record, *, internal: bool = False) -> dict[str, Any]:
    body: dict[str, Any] = {
        "id": str(row["id"]),
        "tenant_id": str(row["tenant_id"]),
        "batch_id": str(row["batch_id"]) if row["batch_id"] else None,
        "client_ref": row["client_ref"],
        "to": row["to_number"],
        "from": row["sender_id"],
        "text": row["body"],
        "encoding": row["encoding"],
        "segments": row["segments"],
        "cost_micros": row["cost_micros"],
        "currency": row["currency"],
        "status": row["status"],
        "attempts": row["attempts"],
        "ambiguous_attempts": row["ambiguous_attempts"],
        "carrier_id": row["carrier_id"],
        "failure_reason": row["failure_reason"],
        "created_at": iso(row["created_at"]),
        "submitted_at": iso(row["submitted_at"]),
        "finalized_at": iso(row["finalized_at"]),
    }
    if internal:
        body["tenant_name"] = row["tenant_name"]
    return body


def event_json(row: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": row["id"],
        "status": row["status"],
        "occurred_at": iso(row["occurred_at"]),
        "detail": row["detail"],
    }


@dataclass(frozen=True, slots=True)
class StatusChange:
    """A status change that was committed. Published to the live stream afterwards."""

    message: asyncpg.Record
    occurred_at: datetime

    def to_event(self) -> dict[str, Any]:
        return {
            "id": str(self.message["id"]),
            "tenant_id": str(self.message["tenant_id"]),
            "status": self.message["status"],
            "occurred_at": iso(self.occurred_at),
            "message": message_json(self.message, internal=True),
        }


async def transition(
    conn: asyncpg.Connection,
    message_id: uuid.UUID,
    to_status: str,
    *,
    detail: dict[str, Any],
    carrier_id: str | None = None,
    failure_reason: str | None = None,
    fence_attempt: int | None = None,
) -> StatusChange | None:
    """Move a message to `to_status` if, and only if, it is in a state that allows it.

    This is a compare-and-set: the WHERE clause names the allowed source
    states, so the row lock taken by the UPDATE decides races. The loser sees
    zero rows and gets None. Nothing else in the code base writes
    `messages.status` after the insert.

    `fence_attempt`: only apply if this is still the newest attempt. A worker
    whose lease expired must not fail or reschedule a message that another
    worker has since picked up.

    Must be called inside a transaction: the event row is written with the
    status, or not at all.
    """
    row = await conn.fetchrow(
        """
        UPDATE messages m
        SET status         = $2,
            carrier_id     = COALESCE($4, m.carrier_id),
            failure_reason = COALESCE($5, m.failure_reason),
            locked_by      = NULL,
            submitted_at   = CASE WHEN $2 = 'SUBMITTED' THEN clock_timestamp() ELSE m.submitted_at END,
            finalized_at   = CASE WHEN $2 = ANY($6::text[]) THEN clock_timestamp() ELSE m.finalized_at END
        FROM tenants t
        WHERE m.id = $1
          AND t.id = m.tenant_id
          AND m.status = ANY($3::text[])
          AND ($7::int IS NULL OR m.attempts = $7)
        RETURNING m.*, t.name AS tenant_name, t.currency
        """,
        message_id,
        to_status,
        list(ALLOWED[to_status]),
        carrier_id,
        failure_reason,
        list(FINAL_STATUSES),
        fence_attempt,
    )
    if row is None:
        return None
    occurred_at = await conn.fetchval(
        """
        INSERT INTO message_events (message_id, tenant_id, status, detail)
        VALUES ($1, $2, $3, $4)
        RETURNING occurred_at
        """,
        message_id,
        row["tenant_id"],
        to_status,
        detail,
    )
    return StatusChange(message=row, occurred_at=occurred_at)
