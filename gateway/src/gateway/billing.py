"""Prepaid billing: charge on accept, refund on failure, and the ledger that proves it.

Invariant, checked by `balance_report`:

    tenants.balance_micros == tenants.opening_balance_micros - SUM(ledger_entries.amount_micros)

Both sides of it are always written in the same transaction.
"""

from __future__ import annotations

import uuid
from typing import Any

import asyncpg


async def charge(conn: asyncpg.Connection, tenant_id: uuid.UUID, amount_micros: int) -> int | None:
    """Take `amount_micros` from the balance. Return the new balance, or None if it is too low.

    One conditional UPDATE. The row lock makes concurrent charges for the
    same tenant queue up, and each one re-checks `balance >= amount` against
    the committed value, so two requests can never both spend the last cent.
    The CHECK (balance_micros >= 0) on the table is the backstop.
    """
    return await conn.fetchval(
        """
        UPDATE tenants
        SET balance_micros = balance_micros - $2
        WHERE id = $1 AND balance_micros >= $2
        RETURNING balance_micros
        """,
        tenant_id,
        amount_micros,
    )


async def refund(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, message_id: uuid.UUID, amount_micros: int
) -> None:
    """Give a message's charge back. Call only from the transition to FAILED.

    A message can enter FAILED once (compare-and-set), so this runs once. If
    a bug ever called it twice, UNIQUE (message_id, kind) on the ledger
    aborts the transaction instead of paying out twice.
    """
    balance_after = await conn.fetchval(
        "UPDATE tenants SET balance_micros = balance_micros + $2 WHERE id = $1 RETURNING balance_micros",
        tenant_id,
        amount_micros,
    )
    await conn.execute(
        """
        INSERT INTO ledger_entries (tenant_id, message_id, kind, amount_micros, balance_after_micros)
        VALUES ($1, $2, 'REFUND', $3, $4)
        """,
        tenant_id,
        message_id,
        -amount_micros,
        balance_after,
    )


async def balance_report(
    conn: asyncpg.Connection | asyncpg.Pool, tenant_id: uuid.UUID | None = None
) -> list[dict[str, Any]]:
    """Balance next to the ledger totals, per tenant, read in one statement (one snapshot)."""
    rows = await conn.fetch(
        """
        SELECT t.id, t.slug, t.currency, t.balance_micros, t.opening_balance_micros,
               COALESCE(SUM(l.amount_micros) FILTER (WHERE l.kind = 'CHARGE'), 0)::bigint AS charged_micros,
               COALESCE(-SUM(l.amount_micros) FILTER (WHERE l.kind = 'REFUND'), 0)::bigint AS refunded_micros,
               COALESCE(SUM(l.amount_micros), 0)::bigint AS ledger_total_micros
        FROM tenants t
        LEFT JOIN ledger_entries l ON l.tenant_id = t.id
        WHERE $1::uuid IS NULL OR t.id = $1
        GROUP BY t.id
        ORDER BY t.name
        """,
        tenant_id,
    )
    return [
        {
            "tenant_id": str(r["id"]),
            "tenant": r["slug"],
            "currency": r["currency"],
            "balance_micros": r["balance_micros"],
            "opening_balance_micros": r["opening_balance_micros"],
            "charged_micros": r["charged_micros"],
            "refunded_micros": r["refunded_micros"],
            "ledger_total_micros": r["ledger_total_micros"],
            "consistent": r["balance_micros"] == r["opening_balance_micros"] - r["ledger_total_micros"],
        }
        for r in rows
    ]
