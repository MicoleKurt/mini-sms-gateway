"""Accepting messages: validate, price, charge and enqueue in ONE transaction.

This is the "money in" path. Either all of these happen or none of them does:

  1. the idempotency key is recorded with the response it will always return,
  2. the tenant's balance goes down by the total cost (never below zero),
  3. the message rows exist with status QUEUED (the row is the queue entry),
  4. the ACCEPTED and QUEUED events exist,
  5. one CHARGE ledger entry exists per message.

Because the queue is a table in the same database, there is no moment where
a message is charged but not queued, or queued but not charged.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any

import asyncpg

from gateway import billing
from gateway.errors import ApiError, validation_error
from gateway.ids import uuid7
from gateway.messages import iso
from gateway.models import MessageIn, Tenant
from gateway.pricing import PriceTable
from gateway.validation import MessageDraft, validate_message

MAX_IDEMPOTENCY_KEY = 255


@dataclass(slots=True)
class AcceptResult:
    status_code: int
    body: dict[str, Any]
    #: True when the body is a stored response for a repeated Idempotency-Key.
    replayed: bool = False
    #: (event type, payload) for the live stream. Published after commit.
    live_events: list[tuple[str, dict[str, Any]]] = field(default_factory=list)


def request_fingerprint(endpoint: str, items: list[MessageIn]) -> str:
    """Hash of what the client asked for. Same key + same fingerprint = a retry."""
    canonical = json.dumps(
        {"endpoint": endpoint, "messages": [[m.to, m.from_, m.text, m.client_ref] for m in items]},
        ensure_ascii=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("ascii")).hexdigest()


def _validate_all(
    items: list[MessageIn], prices: PriceTable, max_segments: int, *, batch: bool
) -> list[MessageDraft]:
    drafts: list[MessageDraft] = []
    errors: list[dict[str, Any]] = []
    for index, item in enumerate(items):
        draft, item_errors = validate_message(
            to=item.to,
            sender=item.from_,
            text=item.text,
            client_ref=item.client_ref,
            prices=prices,
            max_segments=max_segments,
        )
        if draft is not None:
            drafts.append(draft)
        for err in item_errors:
            errors.append({"index": index, **err} if batch else err)
    if errors:
        raise validation_error(errors)
    return drafts


def _replay(stored: asyncpg.Record, fingerprint: str) -> AcceptResult:
    if stored["request_hash"] != fingerprint:
        raise ApiError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "This Idempotency-Key was already used with a different request.",
        )
    return AcceptResult(stored["response_status"], stored["response_body"], replayed=True)


_SELECT_KEY = """
    SELECT request_hash, response_status, response_body
    FROM idempotency_keys
    WHERE tenant_id = $1 AND key = $2
"""


async def accept_messages(
    pool: asyncpg.Pool,
    *,
    tenant: Tenant,
    items: list[MessageIn],
    batch: bool,
    idempotency_key: str | None,
    prices: PriceTable,
    max_segments: int,
) -> AcceptResult:
    endpoint = "batch" if batch else "single"
    fingerprint = request_fingerprint(endpoint, items)

    if idempotency_key is not None:
        if not (1 <= len(idempotency_key) <= MAX_IDEMPOTENCY_KEY):
            raise validation_error(
                [
                    {
                        "field": "Idempotency-Key",
                        "code": "INVALID_VALUE",
                        "message": f"Must be 1 to {MAX_IDEMPOTENCY_KEY} characters.",
                    }
                ]
            )
        # Fast path, and it must come before validation: a retry gets the
        # original answer even if prices or the balance have changed since.
        stored = await pool.fetchrow(_SELECT_KEY, tenant.id, idempotency_key)
        if stored is not None:
            return _replay(stored, fingerprint)

    drafts = _validate_all(items, prices, max_segments, batch=batch)
    total_cost = sum(d.cost_micros for d in drafts)
    ids = [uuid7() for _ in drafts]
    batch_id = uuid7() if batch else None

    async with pool.acquire() as conn, conn.transaction():
        # One clock for everything: the database's.
        created_at = await conn.fetchval("SELECT now()")
        body = _response_body(tenant, drafts, ids, batch_id, created_at, total_cost)

        if idempotency_key is not None:
            # Two requests with the same key can race past the fast path. The
            # primary key settles it: the second INSERT waits for the first
            # transaction to finish, then finds the row and replays it.
            inserted = await conn.fetchval(
                """
                INSERT INTO idempotency_keys (tenant_id, key, request_hash, response_status, response_body)
                VALUES ($1, $2, $3, 202, $4)
                ON CONFLICT (tenant_id, key) DO NOTHING
                RETURNING true
                """,
                tenant.id,
                idempotency_key,
                fingerprint,
                body,
            )
            if not inserted:
                stored = await conn.fetchrow(_SELECT_KEY, tenant.id, idempotency_key)
                if stored is None:
                    raise ApiError(409, "IDEMPOTENCY_CONFLICT", "Concurrent request, try again.")
                return _replay(stored, fingerprint)

        balance_after = await billing.charge(conn, tenant.id, total_cost)
        if balance_after is None:
            # Raising rolls the transaction back, idempotency key included, so
            # the client can top up and retry with the same key.
            raise ApiError(
                402,
                "INSUFFICIENT_BALANCE",
                f"This request costs {total_cost} micros, which is more than the balance.",
            )

        await _insert_messages(conn, tenant, drafts, ids, batch_id, created_at)
        await _insert_charges(conn, tenant, drafts, ids, balance_after + total_cost)

    return AcceptResult(202, body, live_events=_live_events(tenant, drafts, ids, batch_id, created_at))


async def _insert_messages(
    conn: asyncpg.Connection,
    tenant: Tenant,
    drafts: list[MessageDraft],
    ids: list,
    batch_id,
    created_at,
) -> None:
    await conn.execute(
        """
        INSERT INTO messages (id, tenant_id, batch_id, client_ref, to_number, sender_id, body, encoding,
                              segments, price_prefix, unit_price_micros, cost_micros,
                              status, next_attempt_at, created_at)
        SELECT u.id, $1, $2, u.client_ref, u.to_number, u.sender_id, u.body, u.encoding,
               u.segments, u.price_prefix, u.unit_price, u.cost,
               'QUEUED', $3, $3
        FROM unnest($4::uuid[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[],
                    $10::int[], $11::text[], $12::bigint[], $13::bigint[])
             AS u(id, client_ref, to_number, sender_id, body, encoding,
                  segments, price_prefix, unit_price, cost)
        """,
        tenant.id,
        batch_id,
        created_at,
        ids,
        [d.client_ref for d in drafts],
        [d.to for d in drafts],
        [d.sender for d in drafts],
        [d.text for d in drafts],
        [d.analysis.encoding for d in drafts],
        [d.analysis.segments for d in drafts],
        [d.price.prefix for d in drafts],
        [d.price.price_per_segment_micros for d in drafts],
        [d.cost_micros for d in drafts],
    )
    # ACCEPTED and QUEUED are written together: with the queue in the same
    # database, accepting and enqueueing are one atomic step. The two events
    # keep the history complete (see DESIGN.md, "Status model").
    await conn.execute(
        """
        INSERT INTO message_events (message_id, tenant_id, status, occurred_at)
        SELECT u.id, $1, 'ACCEPTED', $2 FROM unnest($3::uuid[]) AS u(id)
        """,
        tenant.id,
        created_at,
        ids,
    )
    await conn.execute(
        """
        INSERT INTO message_events (message_id, tenant_id, status)
        SELECT u.id, $1, 'QUEUED' FROM unnest($2::uuid[]) AS u(id)
        """,
        tenant.id,
        ids,
    )


async def _insert_charges(
    conn: asyncpg.Connection, tenant: Tenant, drafts: list[MessageDraft], ids: list, balance_before: int
) -> None:
    """One CHARGE row per message, each with the running balance after it."""
    running = balance_before
    balances_after: list[int] = []
    for draft in drafts:
        running -= draft.cost_micros
        balances_after.append(running)
    await conn.execute(
        """
        INSERT INTO ledger_entries (tenant_id, message_id, kind, amount_micros, balance_after_micros)
        SELECT $1, u.id, 'CHARGE', u.cost, u.balance_after
        FROM unnest($2::uuid[], $3::bigint[], $4::bigint[]) WITH ORDINALITY
             AS u(id, cost, balance_after, ord)
        ORDER BY u.ord
        """,
        tenant.id,
        ids,
        [d.cost_micros for d in drafts],
        balances_after,
    )


def _message_receipt(draft: MessageDraft, message_id) -> dict[str, Any]:
    return {
        "id": str(message_id),
        "status": "ACCEPTED",
        "to": draft.to,
        "client_ref": draft.client_ref,
        "encoding": draft.analysis.encoding,
        "segments": draft.analysis.segments,
        "cost_micros": draft.cost_micros,
    }


def _response_body(
    tenant: Tenant, drafts: list[MessageDraft], ids: list, batch_id, created_at, total_cost: int
) -> dict[str, Any]:
    if batch_id is None:
        draft = drafts[0]
        receipt = _message_receipt(draft, ids[0])
        return {
            "id": receipt["id"],
            "status": "ACCEPTED",
            "to": draft.to,
            "from": draft.sender,
            "client_ref": draft.client_ref,
            "encoding": receipt["encoding"],
            "segments": receipt["segments"],
            "cost_micros": receipt["cost_micros"],
            "currency": tenant.currency,
            "created_at": iso(created_at),
        }
    return {
        "batch_id": str(batch_id),
        "count": len(drafts),
        "total_segments": sum(d.analysis.segments for d in drafts),
        "total_cost_micros": total_cost,
        "currency": tenant.currency,
        "created_at": iso(created_at),
        "messages": [_message_receipt(d, i) for d, i in zip(drafts, ids, strict=True)],
    }


def _live_events(
    tenant: Tenant, drafts: list[MessageDraft], ids: list, batch_id, created_at
) -> list[tuple[str, dict[str, Any]]]:
    """A single message is announced in full. A batch is one event, not a thousand."""
    occurred_at = iso(created_at)
    if batch_id is not None:
        return [
            (
                "batch",
                {
                    "batch_id": str(batch_id),
                    "tenant_id": str(tenant.id),
                    "count": len(drafts),
                    "occurred_at": occurred_at,
                },
            )
        ]
    draft, message_id = drafts[0], ids[0]
    message = {
        "id": str(message_id),
        "tenant_id": str(tenant.id),
        "tenant_name": tenant.name,
        "batch_id": None,
        "client_ref": draft.client_ref,
        "to": draft.to,
        "from": draft.sender,
        "text": draft.text,
        "encoding": draft.analysis.encoding,
        "segments": draft.analysis.segments,
        "cost_micros": draft.cost_micros,
        "currency": tenant.currency,
        "status": "QUEUED",
        "attempts": 0,
        "ambiguous_attempts": 0,
        "carrier_id": None,
        "failure_reason": None,
        "created_at": occurred_at,
        "submitted_at": None,
        "finalized_at": None,
    }
    return [
        (
            "message",
            {
                "id": message["id"],
                "tenant_id": message["tenant_id"],
                "status": "QUEUED",
                "occurred_at": occurred_at,
                "message": message,
            },
        )
    ]
