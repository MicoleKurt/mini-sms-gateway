"""Price lookup by destination prefix. The longest matching prefix wins."""

from __future__ import annotations

import time
from dataclasses import dataclass

import asyncpg


@dataclass(frozen=True, slots=True)
class Price:
    prefix: str
    country: str
    price_per_segment_micros: int


class PriceTable:
    def __init__(self, prices: list[Price]) -> None:
        # Longest first, so "+1242" would win over "+1".
        self._prices = sorted(prices, key=lambda p: len(p.prefix), reverse=True)

    def lookup(self, to_number: str) -> Price | None:
        for price in self._prices:
            if to_number.startswith(price.prefix):
                return price
        return None

    def all(self) -> list[Price]:
        return sorted(self._prices, key=lambda p: p.prefix)


async def load_price_table(conn: asyncpg.Connection | asyncpg.Pool) -> PriceTable:
    rows = await conn.fetch("SELECT prefix, country, price_per_segment_micros FROM prices")
    return PriceTable([Price(r["prefix"], r["country"], r["price_per_segment_micros"]) for r in rows])


class PriceCache:
    """The price table is tiny and rarely changes, so each API process keeps a
    short-lived copy instead of reading it on every request.

    A price change takes up to `ttl` seconds to apply. The price a message was
    charged at is stored on the message row, so a later change never rewrites
    history.
    """

    def __init__(self, pool: asyncpg.Pool, ttl: float) -> None:
        self._pool = pool
        self._ttl = ttl
        self._table: PriceTable | None = None
        self._loaded_at = 0.0

    async def get(self) -> PriceTable:
        now = time.monotonic()
        if self._table is None or now - self._loaded_at > self._ttl:
            self._table = await load_price_table(self._pool)
            self._loaded_at = now
        return self._table
