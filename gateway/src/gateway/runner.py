"""Entry points for the background processes.

    python -m gateway.runner dispatcher
    python -m gateway.runner webhooks

Each is its own process with its own connection pool. They share nothing in
memory: coordination goes through PostgreSQL (the queue and its leases) and
Redis (the carrier rate limit).
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import logging
import signal

import redis.asyncio as aioredis
from prometheus_client import start_http_server

from gateway.carrier import CarrierClient
from gateway.config import Settings, get_settings
from gateway.db import create_pool, wait_for_database
from gateway.dispatch import Dispatcher
from gateway.limiter import RateLimiter
from gateway.live import LivePublisher
from gateway.webhooks import WebhookWorker

log = logging.getLogger("gateway.runner")


def _install_signal_handlers(stop: asyncio.Event) -> None:
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        # add_signal_handler does not exist on Windows; Ctrl+C still raises
        # KeyboardInterrupt there, which ends the process.
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, stop.set)


async def run_dispatcher(settings: Settings) -> None:
    await wait_for_database(settings.database_url)
    pool = await create_pool(
        settings.database_url, min_size=settings.db_pool_min, max_size=settings.db_pool_max
    )
    redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
    carrier = CarrierClient(
        settings.carrier_url,
        timeout_seconds=settings.carrier_timeout_seconds,
        max_connections=settings.worker_max_in_flight,
    )
    limiter = RateLimiter(
        redis_client, rate_per_second=settings.carrier_target_rate, burst=settings.carrier_burst
    )
    dispatcher = Dispatcher(
        pool=pool,
        limiter=limiter,
        carrier=carrier,
        publisher=LivePublisher(redis_client),
        settings=settings,
    )
    stop = asyncio.Event()
    _install_signal_handlers(stop)
    try:
        await dispatcher.run(stop)
    finally:
        await carrier.aclose()
        await redis_client.aclose()
        await pool.close()


async def run_webhooks(settings: Settings) -> None:
    await wait_for_database(settings.database_url)
    pool = await create_pool(
        settings.database_url, min_size=settings.db_pool_min, max_size=settings.db_pool_max
    )
    worker = WebhookWorker(pool=pool, settings=settings)
    stop = asyncio.Event()
    _install_signal_handlers(stop)
    try:
        await worker.run(stop)
    finally:
        await worker.aclose()
        await pool.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a gateway background process.")
    parser.add_argument("process", choices=["dispatcher", "webhooks"])
    args = parser.parse_args()

    settings = get_settings()
    logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    if settings.metrics_port:
        start_http_server(settings.metrics_port)

    target = run_dispatcher if args.process == "dispatcher" else run_webhooks
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(target(settings))


if __name__ == "__main__":
    main()
