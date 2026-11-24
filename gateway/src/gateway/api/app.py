"""The HTTP application: tenant API, carrier callback, internal API, health and metrics."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import asyncpg
from fastapi import FastAPI, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from gateway import metrics, queries
from gateway.api import carrier_callbacks, internal, tenant
from gateway.config import Settings, get_settings
from gateway.db import create_pool
from gateway.errors import ApiError, install_error_handlers
from gateway.live import LiveHub, LivePublisher
from gateway.pricing import PriceCache
from gateway.valkey import connect, connect_subscriber

log = logging.getLogger(__name__)


def create_app(
    settings: Settings | None = None,
    *,
    pool: asyncpg.Pool | None = None,
    redis_client: Any | None = None,
) -> FastAPI:
    """Build the app. Tests pass their own pool and Redis client; in production
    both are created at startup and closed at shutdown."""
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        owns_pool = pool is None
        owns_redis = redis_client is None
        app.state.settings = settings
        app.state.pool = pool or await create_pool(
            settings.database_url, min_size=settings.db_pool_min, max_size=settings.db_pool_max
        )
        timeout = settings.redis_timeout_seconds
        app.state.redis = redis_client or connect(settings.redis_url, timeout_seconds=timeout)
        subscriber = redis_client or connect_subscriber(settings.redis_url, timeout_seconds=timeout)
        app.state.publisher = LivePublisher(app.state.redis, settings.live_channel)
        app.state.prices = PriceCache(app.state.pool, settings.price_cache_seconds)
        app.state.hub = LiveHub(
            subscriber, lambda: queries.live_stats(app.state.pool), channel=settings.live_channel
        )
        await app.state.hub.start()
        try:
            yield
        finally:
            await app.state.hub.stop()
            if owns_redis:
                await app.state.redis.aclose()
                await subscriber.aclose()
            if owns_pool:
                await app.state.pool.close()

    app = FastAPI(
        title="Mini SMS Gateway",
        version="0.1.0",
        description="Send API, prepaid billing, fair rate-limited dispatch and delivery receipts.",
        lifespan=lifespan,
    )
    install_error_handlers(app)
    app.include_router(tenant.router)
    app.include_router(carrier_callbacks.router)
    app.include_router(internal.router)

    @app.get("/healthz", tags=["ops"])
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz", tags=["ops"])
    async def readyz() -> dict[str, str]:
        try:
            await app.state.pool.fetchval("SELECT 1")
            await app.state.redis.ping()
        except Exception as exc:
            raise ApiError(503, "NOT_READY", f"Dependency check failed: {type(exc).__name__}") from exc
        return {"status": "ready"}

    @app.get("/metrics", tags=["ops"])
    async def prometheus_metrics() -> Response:
        # The queue gauges are read at scrape time; otherwise they would only
        # move while a dashboard is connected.
        try:
            await queries.queue_stats(app.state.pool)
        except Exception:
            log.warning("could not refresh the queue gauges", exc_info=True)
        return Response(generate_latest() + generate_latest(metrics.API_ONLY), media_type=CONTENT_TYPE_LATEST)

    return app


def app_factory() -> FastAPI:
    """Entry point for `uvicorn gateway.api.app:app_factory --factory`."""
    settings = get_settings()
    logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    return create_app(settings)
