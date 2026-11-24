"""Request dependencies: shared state and authentication."""

from __future__ import annotations

import hashlib
import hmac
from typing import Annotated

import asyncpg
from fastapi import Depends, Header, Request

from gateway.config import Settings
from gateway.errors import unauthorized
from gateway.live import LiveHub, LivePublisher
from gateway.models import Tenant
from gateway.pricing import PriceCache


def get_pool(request: Request) -> asyncpg.Pool:
    return request.app.state.pool


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_publisher(request: Request) -> LivePublisher:
    return request.app.state.publisher


def get_prices(request: Request) -> PriceCache:
    return request.app.state.prices


def get_hub(request: Request) -> LiveHub:
    return request.app.state.hub


def hash_api_key(api_key: str) -> str:
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()


async def require_tenant(
    pool: Annotated[asyncpg.Pool, Depends(get_pool)],
    x_api_key: Annotated[str | None, Header()] = None,
) -> Tenant:
    """Resolve X-API-Key to a tenant. Only the SHA-256 of a key is stored, and
    the lookup is by that hash, so the comparison does not leak timing about
    the key itself."""
    if not x_api_key:
        raise unauthorized("Missing X-API-Key header.")
    row = await pool.fetchrow(
        "SELECT id, slug, name, currency FROM tenants WHERE api_key_hash = $1", hash_api_key(x_api_key)
    )
    if row is None:
        raise unauthorized("Unknown API key.")
    return Tenant(id=row["id"], slug=row["slug"], name=row["name"], currency=row["currency"])


async def require_admin(
    settings: Annotated[Settings, Depends(get_settings)],
    x_admin_token: Annotated[str | None, Header()] = None,
) -> None:
    if not x_admin_token or not hmac.compare_digest(
        x_admin_token.encode("utf-8"), settings.admin_token.encode("utf-8")
    ):
        raise unauthorized("Missing or invalid X-Admin-Token header.")


PoolDep = Annotated[asyncpg.Pool, Depends(get_pool)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
PublisherDep = Annotated[LivePublisher, Depends(get_publisher)]
PricesDep = Annotated[PriceCache, Depends(get_prices)]
TenantDep = Annotated[Tenant, Depends(require_tenant)]
