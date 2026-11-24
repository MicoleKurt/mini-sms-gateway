"""Read-side queries: lists, counts and the numbers behind the dashboard."""

from __future__ import annotations

import base64
import json
import uuid
from datetime import datetime
from typing import Any

import asyncpg

from gateway import billing, metrics
from gateway.errors import validation_error
from gateway.messages import SELECT_MESSAGE, iso
from gateway.status import ALL_STATUSES, FINAL_STATUSES

# --- keyset cursors ----------------------------------------------------------


def encode_cursor(*parts: Any) -> str:
    raw = json.dumps([str(p) for p in parts]).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_cursor(cursor: str, expected_parts: int) -> list[str]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        parts = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
        if not isinstance(parts, list) or len(parts) != expected_parts:
            raise ValueError
        return [str(p) for p in parts]
    except (ValueError, UnicodeError) as exc:
        raise validation_error(
            [{"field": "cursor", "code": "INVALID_VALUE", "message": "Not a cursor from this API."}]
        ) from exc


# --- messages ------------------------------------------------------------------


async def list_messages(
    pool: asyncpg.Pool,
    *,
    tenant_id: uuid.UUID | None,
    status: str | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    client_ref: str | None = None,
    batch_id: uuid.UUID | None = None,
    search: str | None = None,
    limit: int,
    cursor: str | None,
) -> tuple[list[asyncpg.Record], str | None]:
    """Newest first, keyset-paginated on (created_at, id).

    Keyset, not OFFSET: page N costs the same as page 1, and rows that arrive
    while someone pages do not shift what they see next.
    """
    conditions: list[str] = []
    args: list[Any] = []

    def where(condition: str, *values: Any) -> None:
        placeholders = []
        for value in values:
            args.append(value)
            placeholders.append(f"${len(args)}")
        conditions.append(condition.format(*placeholders))

    if tenant_id is not None:
        where("m.tenant_id = {}", tenant_id)
    if status is not None:
        where("m.status = {}", status)
    if created_from is not None:
        where("m.created_at >= {}", created_from)
    if created_to is not None:
        where("m.created_at <= {}", created_to)
    if client_ref is not None:
        where("m.client_ref = {}", client_ref)
    if batch_id is not None:
        where("m.batch_id = {}", batch_id)
    if search:
        try:
            where("m.id = {}", uuid.UUID(search))
        except ValueError:
            where("(m.to_number = {0} OR m.client_ref = {0})", search)
    if cursor is not None:
        created_at, message_id = decode_cursor(cursor, 2)
        try:
            where(
                "(m.created_at, m.id) < ({}, {})", datetime.fromisoformat(created_at), uuid.UUID(message_id)
            )
        except ValueError as exc:
            raise validation_error(
                [{"field": "cursor", "code": "INVALID_VALUE", "message": "Not a cursor from this API."}]
            ) from exc

    args.append(limit + 1)
    sql = SELECT_MESSAGE
    if conditions:
        sql += " WHERE " + " AND ".join(conditions)
    sql += f" ORDER BY m.created_at DESC, m.id DESC LIMIT ${len(args)}"

    rows = await pool.fetch(sql, *args)
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        next_cursor = encode_cursor(last["created_at"].isoformat(), last["id"])
    return rows, next_cursor


async def get_message(
    pool: asyncpg.Pool, message_id: uuid.UUID, tenant_id: uuid.UUID | None
) -> asyncpg.Record | None:
    """One message. With a tenant_id, a message of another tenant does not exist."""
    return await pool.fetchrow(
        SELECT_MESSAGE + " WHERE m.id = $1 AND ($2::uuid IS NULL OR m.tenant_id = $2)",
        message_id,
        tenant_id,
    )


async def message_events(pool: asyncpg.Pool, message_id: uuid.UUID) -> list[asyncpg.Record]:
    return await pool.fetch(
        "SELECT id, status, occurred_at, detail FROM message_events WHERE message_id = $1 ORDER BY id",
        message_id,
    )


def empty_counts() -> dict[str, int]:
    return dict.fromkeys(ALL_STATUSES, 0)


async def status_counts(pool: asyncpg.Pool, tenant_id: uuid.UUID | None = None) -> dict[str, dict[str, int]]:
    """{tenant_id: {status: count}} with every status present."""
    rows = await pool.fetch(
        """
        SELECT tenant_id, status, count(*) AS n
        FROM messages
        WHERE $1::uuid IS NULL OR tenant_id = $1
        GROUP BY tenant_id, status
        """,
        tenant_id,
    )
    counts: dict[str, dict[str, int]] = {}
    for row in rows:
        counts.setdefault(str(row["tenant_id"]), empty_counts())[row["status"]] = row["n"]
    return counts


# --- ledger --------------------------------------------------------------------


async def list_ledger(
    pool: asyncpg.Pool, tenant_id: uuid.UUID, *, limit: int, cursor: str | None
) -> tuple[list[dict[str, Any]], str | None]:
    after_id = 0
    if cursor is not None:
        try:
            after_id = int(decode_cursor(cursor, 1)[0])
        except ValueError as exc:
            raise validation_error(
                [{"field": "cursor", "code": "INVALID_VALUE", "message": "Not a cursor from this API."}]
            ) from exc
    rows = await pool.fetch(
        """
        SELECT id, message_id, kind, amount_micros, balance_after_micros, created_at
        FROM ledger_entries
        WHERE tenant_id = $1 AND id > $2
        ORDER BY id
        LIMIT $3
        """,
        tenant_id,
        after_id,
        limit + 1,
    )
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        next_cursor = encode_cursor(rows[-1]["id"])
    return [ledger_json(r) for r in rows], next_cursor


def ledger_json(row: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": row["id"],
        "message_id": str(row["message_id"]),
        "kind": row["kind"],
        "amount_micros": row["amount_micros"],
        "balance_after_micros": row["balance_after_micros"],
        "created_at": iso(row["created_at"]),
    }


# --- dashboard -----------------------------------------------------------------


async def tenant_summaries(pool: asyncpg.Pool) -> list[dict[str, Any]]:
    tenants = await pool.fetch(
        """
        SELECT id, slug, name, currency, balance_micros, opening_balance_micros,
               callback_url, api_key_prefix
        FROM tenants
        ORDER BY name
        """
    )
    counts = await status_counts(pool)
    summaries = []
    for t in tenants:
        tenant_counts = counts.get(str(t["id"]), empty_counts())
        summaries.append(
            {
                "id": str(t["id"]),
                "slug": t["slug"],
                "name": t["name"],
                "currency": t["currency"],
                "balance_micros": t["balance_micros"],
                "opening_balance_micros": t["opening_balance_micros"],
                "callback_url": t["callback_url"],
                "api_key_prefix": t["api_key_prefix"],
                "counts": tenant_counts,
                "total_messages": sum(tenant_counts.values()),
            }
        )
    return summaries


async def queue_stats(pool: asyncpg.Pool) -> dict[str, int]:
    row = await pool.fetchrow(
        """
        SELECT
            (SELECT count(*) FROM messages WHERE status = 'QUEUED') AS depth,
            (SELECT count(*) FROM submit_attempts WHERE outcome IS NULL) AS in_flight,
            -- Age of the oldest message that is ready to send. One index
            -- probe per tenant instead of a scan of the whole queue.
            (SELECT COALESCE(EXTRACT(EPOCH FROM now() - min(oldest.created_at)) * 1000, 0)
             FROM dispatch_cursor c
             CROSS JOIN LATERAL (
                 SELECT m.created_at
                 FROM messages m
                 WHERE m.tenant_id = c.tenant_id AND m.status = 'QUEUED' AND m.next_attempt_at <= now()
                 ORDER BY m.id
                 LIMIT 1) oldest) AS oldest_age_ms
        """
    )
    metrics.QUEUE_DEPTH.set(row["depth"])
    metrics.IN_FLIGHT.set(row["in_flight"])
    return {"depth": row["depth"], "oldest_age_ms": int(row["oldest_age_ms"]), "in_flight": row["in_flight"]}


async def throughput(pool: asyncpg.Pool, seconds: int = 60) -> list[dict[str, Any]]:
    """Submits to the carrier and final states per second, for complete seconds only."""
    rows = await pool.fetch(
        """
        WITH bounds AS (
            SELECT date_trunc('second', now()) - make_interval(secs => $1) AS start_at,
                   date_trunc('second', now()) AS end_at
        ),
        ticks AS (
            SELECT generate_series(b.start_at, b.end_at - interval '1 second', interval '1 second') AS t
            FROM bounds b
        ),
        submits AS (
            SELECT date_trunc('second', a.started_at) AS t, count(*) AS n
            FROM submit_attempts a, bounds b
            WHERE a.started_at >= b.start_at AND a.started_at < b.end_at
            GROUP BY 1
        ),
        finals AS (
            SELECT date_trunc('second', e.occurred_at) AS t, count(*) AS n
            FROM message_events e, bounds b
            WHERE e.occurred_at >= b.start_at AND e.occurred_at < b.end_at
              AND e.status = ANY($2::text[])
            GROUP BY 1
        )
        SELECT ticks.t, COALESCE(submits.n, 0) AS submitted, COALESCE(finals.n, 0) AS finalized
        FROM ticks
        LEFT JOIN submits USING (t)
        LEFT JOIN finals USING (t)
        ORDER BY ticks.t
        """,
        float(seconds),
        list(FINAL_STATUSES),
    )
    return [{"t": iso(r["t"]), "submitted": r["submitted"], "finalized": r["finalized"]} for r in rows]


async def webhook_counts(pool: asyncpg.Pool) -> dict[str, int]:
    rows = await pool.fetch("SELECT status, count(*) AS n FROM webhook_deliveries GROUP BY status")
    counts = {"pending": 0, "delivered": 0, "dead": 0}
    for row in rows:
        counts[row["status"].lower()] = row["n"]
    return counts


async def billing_checks(pool: asyncpg.Pool) -> list[dict[str, Any]]:
    report = await billing.balance_report(pool)
    doubles = await pool.fetch(
        """
        SELECT tenant_id, count(*) AS n
        FROM (
            SELECT tenant_id, message_id
            FROM ledger_entries
            WHERE kind = 'CHARGE'
            GROUP BY tenant_id, message_id
            HAVING count(*) > 1
        ) repeated
        GROUP BY tenant_id
        """
    )
    double_by_tenant = {str(r["tenant_id"]): r["n"] for r in doubles}
    return [
        {
            "tenant_id": r["tenant_id"],
            "consistent": r["consistent"],
            "double_charged": double_by_tenant.get(r["tenant_id"], 0),
        }
        for r in report
    ]


async def live_stats(pool: asyncpg.Pool) -> dict[str, Any]:
    """The once-a-second snapshot pushed to every dashboard."""
    tenants = await tenant_summaries(pool)
    last_second = await throughput(pool, seconds=1)
    rate = last_second[0] if last_second else {"t": None, "submitted": 0, "finalized": 0}
    return {
        "at": rate["t"],
        "tenants": [
            {
                "id": t["id"],
                "balance_micros": t["balance_micros"],
                "counts": t["counts"],
                "total_messages": t["total_messages"],
            }
            for t in tenants
        ],
        "queue": await queue_stats(pool),
        "rate": {"submitted_per_second": rate["submitted"], "finalized_per_second": rate["finalized"]},
    }
