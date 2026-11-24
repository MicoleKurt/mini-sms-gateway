"""Seed data for the local demo: two tenants, their API keys and balances, and a price table.

Safe to run on every start: existing rows are left alone, so balances and
messages survive a restart.
"""

from __future__ import annotations

import hashlib
import uuid

import asyncpg

from gateway.config import Settings

ACME_ID = uuid.UUID("0a000000-0000-4000-8000-000000000001")
SHOPFAST_ID = uuid.UUID("0a000000-0000-4000-8000-000000000002")

USD = 1_000_000  # micros

PRICES = [
    ("+880", "Bangladesh", 4_000),
    ("+971", "United Arab Emirates", 21_000),
    ("+63", "Philippines", 3_500),
    ("+44", "United Kingdom", 38_000),
    ("+1", "United States/Canada", 7_500),
]


async def seed(conn: asyncpg.Connection, settings: Settings) -> None:
    tenants = [
        (ACME_ID, "acme-bank", "Acme Bank", settings.seed_acme_api_key, 250 * USD,
         settings.seed_acme_callback_url, "whsec_acme_dev_secret"),
        (SHOPFAST_ID, "shopfast", "ShopFast", settings.seed_shopfast_api_key, 1_000 * USD,
         settings.seed_shopfast_callback_url, "whsec_shopfast_dev_secret"),
    ]  # fmt: skip
    async with conn.transaction():
        for tenant_id, slug, name, api_key, opening, callback_url, webhook_secret in tenants:
            await conn.execute(
                """
                INSERT INTO tenants (id, slug, name, api_key_hash, api_key_prefix,
                                     opening_balance_micros, balance_micros, callback_url, webhook_secret)
                VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8)
                ON CONFLICT (id) DO NOTHING
                """,
                tenant_id,
                slug,
                name,
                hashlib.sha256(api_key.encode("utf-8")).hexdigest(),
                api_key[:8],
                opening,
                callback_url,
                webhook_secret,
            )
        await conn.executemany(
            """
            INSERT INTO prices (prefix, country, price_per_segment_micros)
            VALUES ($1, $2, $3)
            ON CONFLICT (prefix) DO NOTHING
            """,
            PRICES,
        )
