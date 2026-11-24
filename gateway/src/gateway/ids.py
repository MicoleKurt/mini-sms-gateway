"""UUIDv7 message IDs: time-ordered, so new rows land at the end of the index."""

from __future__ import annotations

import secrets
import time
import uuid


def uuid7() -> uuid.UUID:
    """48 bits of Unix milliseconds, then version, variant and 74 random bits (RFC 9562)."""
    millis = time.time_ns() // 1_000_000
    value = (
        (millis & 0xFFFF_FFFF_FFFF) << 80
        | 0x7 << 76
        | secrets.randbits(12) << 64
        | 0b10 << 62
        | secrets.randbits(62)
    )
    return uuid.UUID(int=value)
