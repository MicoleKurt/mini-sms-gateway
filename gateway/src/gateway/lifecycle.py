"""Moving a message into a final state, with everything that must happen with it.

Each function runs inside the caller's transaction, so the status change,
its event, the refund and the webhook outbox row are committed together.
"""

from __future__ import annotations

import uuid
from typing import Any

import asyncpg

from gateway import billing
from gateway.ids import uuid7
from gateway.messages import StatusChange, iso, transition
from gateway.status import FAILED


async def fail_message(
    conn: asyncpg.Connection,
    message_id: uuid.UUID,
    *,
    reason: str,
    detail: dict[str, Any],
    fence_attempt: int | None,
) -> StatusChange | None:
    """QUEUED -> FAILED, refund the charge, queue the tenant webhook.

    FAILED is only reachable from QUEUED, which means the carrier never told
    us it accepted the message, so the tenant gets the money back. (UNDELIV
    and EXPIRED are reached from SUBMITTED and keep the charge: the carrier
    has billed us.)
    """
    change = await transition(
        conn,
        message_id,
        FAILED,
        detail={"reason": reason, **detail},
        failure_reason=reason,
        fence_attempt=fence_attempt,
    )
    if change is None:
        return None
    message = change.message
    await billing.refund(conn, message["tenant_id"], message_id, message["cost_micros"])
    await enqueue_webhook(conn, message)
    return change


async def finalize_from_dlr(
    conn: asyncpg.Connection,
    message_id: uuid.UUID,
    status: str,
    *,
    detail: dict[str, Any],
    failure_reason: str | None = None,
) -> StatusChange | None:
    """SUBMITTED -> DELIVERED | UNDELIVERED | EXPIRED, queue the tenant webhook.

    Also used by the sweep for a DLR that never came (`gateway.sweeper`).
    """
    change = await transition(conn, message_id, status, detail=detail, failure_reason=failure_reason)
    if change is None:
        return None
    await enqueue_webhook(conn, change.message)
    return change


async def enqueue_webhook(conn: asyncpg.Connection, message: asyncpg.Record) -> None:
    """Write the outbox row for the tenant callback, if the tenant has a callback URL.

    The row is committed with the status change, so a final state can never
    be reached without its webhook being scheduled, and UNIQUE (message_id)
    means it is scheduled once.
    """
    delivery_id = uuid7()
    payload = {
        "id": str(delivery_id),
        "type": "message.status",
        "message": {
            "id": str(message["id"]),
            "client_ref": message["client_ref"],
            "to": message["to_number"],
            "status": message["status"],
            "segments": message["segments"],
            "cost_micros": message["cost_micros"],
            "failure_reason": message["failure_reason"],
            "finalized_at": iso(message["finalized_at"]),
        },
    }
    await conn.execute(
        """
        INSERT INTO webhook_deliveries (id, tenant_id, message_id, url, payload)
        SELECT $1, t.id, $2, t.callback_url, $3
        FROM tenants t
        WHERE t.id = $4 AND t.callback_url IS NOT NULL
        ON CONFLICT (message_id) DO NOTHING
        """,
        delivery_id,
        message["id"],
        payload,
        message["tenant_id"],
    )
