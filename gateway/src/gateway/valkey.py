"""Valkey clients. Every client the gateway creates goes through here.

A Valkey that accepts connections and never answers (paused, or behind a
broken network path) must make a call fail after a short time, not hang the
request or the worker that made it. redis-py waits for ever by default.
"""

from __future__ import annotations

import redis.asyncio as aioredis


def connect(url: str, *, timeout_seconds: float) -> aioredis.Redis:
    """A client for commands: every connect and every reply is bounded."""
    return aioredis.from_url(
        url,
        decode_responses=True,
        socket_timeout=timeout_seconds,
        socket_connect_timeout=timeout_seconds,
    )


def connect_subscriber(url: str, *, timeout_seconds: float) -> aioredis.Redis:
    """A client for a pub/sub subscription.

    An idle subscription legitimately waits for minutes between messages, so
    a read timeout would only break it. The connect is still bounded, and
    keepalive lets the operating system notice a dead peer.
    """
    return aioredis.from_url(
        url,
        decode_responses=True,
        socket_connect_timeout=timeout_seconds,
        socket_keepalive=True,
    )
