"""The tenant API. Every query here is scoped by `tenant.id`."""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Header, Query
from fastapi.responses import JSONResponse

from gateway import billing, metrics, queries
from gateway.accept import AcceptResult, accept_messages
from gateway.api.deps import PoolDep, PricesDep, PublisherDep, SettingsDep, TenantDep
from gateway.errors import not_found, validation_error
from gateway.messages import event_json, message_json
from gateway.models import BatchIn, MessageIn, WebhookIn
from gateway.validation import MAX_CLIENT_REF, is_storable
from gateway.webhooks import is_valid_callback_url

router = APIRouter(prefix="/v1", tags=["tenant"])

StatusFilter = Literal["ACCEPTED", "QUEUED", "SUBMITTED", "DELIVERED", "UNDELIVERED", "EXPIRED", "FAILED"]


def accept_response(result: AcceptResult) -> JSONResponse:
    headers = {"Idempotent-Replay": "true"} if result.replayed else None
    return JSONResponse(result.body, status_code=result.status_code, headers=headers)


def as_utc(value: datetime | None, field: str) -> datetime | None:
    """A timestamp without an offset is read as UTC, as the API documents.

    The conversion happens here so that a time which leaves the datetime range
    in UTC (year 1 at +14:00, year 9999 at -12:00) is a 422 and not an
    overflow inside the database driver.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    try:
        return value.astimezone(UTC)
    except OverflowError as exc:
        raise validation_error(
            [{"field": field, "code": "INVALID_VALUE", "message": "Out of range."}]
        ) from exc


def storable_query(value: str | None, field: str) -> str | None:
    """A query value is compared with a text column, which cannot hold NUL."""
    if value is not None and not is_storable(value):
        raise validation_error(
            [
                {
                    "field": field,
                    "code": "INVALID_VALUE",
                    "message": "Contains a NUL character or an unpaired surrogate.",
                }
            ]
        )
    return value


def parse_message_id(raw: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except ValueError as exc:
        # Not an ID we could have issued, so there is nothing to find.
        raise not_found("Message") from exc


@router.post("/messages", status_code=202)
async def send_message(
    body: MessageIn,
    tenant: TenantDep,
    pool: PoolDep,
    prices: PricesDep,
    settings: SettingsDep,
    publisher: PublisherDep,
    idempotency_key: Annotated[str | None, Header()] = None,
) -> JSONResponse:
    result = await accept_messages(
        pool,
        tenant=tenant,
        items=[body],
        batch=False,
        idempotency_key=idempotency_key,
        prices=await prices.get(),
        max_segments=settings.max_segments,
    )
    if not result.replayed:
        metrics.MESSAGES_ACCEPTED.inc()
        await publisher.publish_all(result.live_events)
    return accept_response(result)


@router.post("/messages/batch", status_code=202)
async def send_batch(
    body: BatchIn,
    tenant: TenantDep,
    pool: PoolDep,
    prices: PricesDep,
    settings: SettingsDep,
    publisher: PublisherDep,
    idempotency_key: Annotated[str | None, Header()] = None,
) -> JSONResponse:
    result = await accept_messages(
        pool,
        tenant=tenant,
        items=body.messages,
        batch=True,
        idempotency_key=idempotency_key,
        prices=await prices.get(),
        max_segments=settings.max_segments,
    )
    if not result.replayed:
        metrics.MESSAGES_ACCEPTED.inc(len(body.messages))
        await publisher.publish_all(result.live_events)
    return accept_response(result)


@router.get("/messages")
async def list_messages(
    tenant: TenantDep,
    pool: PoolDep,
    status: StatusFilter | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    client_ref: Annotated[str | None, Query(min_length=1, max_length=MAX_CLIENT_REF)] = None,
    batch_id: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=1000)] = 50,
    cursor: str | None = None,
) -> dict[str, Any]:
    rows, next_cursor = await queries.list_messages(
        pool,
        tenant_id=tenant.id,
        status=status,
        created_from=as_utc(created_from, "created_from"),
        created_to=as_utc(created_to, "created_to"),
        client_ref=storable_query(client_ref, "client_ref"),
        batch_id=batch_id,
        limit=limit,
        cursor=cursor,
    )
    return {"data": [message_json(r) for r in rows], "next_cursor": next_cursor}


# Declared before /messages/{message_id} so "stats" is not read as an ID.
@router.get("/messages/stats")
async def message_stats(tenant: TenantDep, pool: PoolDep) -> dict[str, Any]:
    counts = (await queries.status_counts(pool, tenant.id)).get(str(tenant.id), queries.empty_counts())
    return {"total": sum(counts.values()), "counts": counts}


@router.get("/messages/{message_id}")
async def get_message(message_id: str, tenant: TenantDep, pool: PoolDep) -> dict[str, Any]:
    # The tenant filter is in the query itself. A message that belongs to
    # another tenant is indistinguishable from one that does not exist: 404.
    row = await queries.get_message(pool, parse_message_id(message_id), tenant.id)
    if row is None:
        raise not_found("Message")
    events = await queries.message_events(pool, row["id"])
    return {**message_json(row), "events": [event_json(e) for e in events]}


@router.get("/balance")
async def get_balance(tenant: TenantDep, pool: PoolDep) -> dict[str, Any]:
    report = (await billing.balance_report(pool, tenant.id))[0]
    del report["tenant_id"]
    return report


@router.get("/ledger")
async def get_ledger(
    tenant: TenantDep,
    pool: PoolDep,
    limit: Annotated[int, Query(ge=1, le=1000)] = 100,
    cursor: str | None = None,
) -> dict[str, Any]:
    entries, next_cursor = await queries.list_ledger(pool, tenant.id, limit=limit, cursor=cursor)
    return {"data": entries, "next_cursor": next_cursor}


@router.get("/webhook")
async def get_webhook(tenant: TenantDep, pool: PoolDep) -> dict[str, Any]:
    row = await pool.fetchrow("SELECT callback_url, webhook_secret FROM tenants WHERE id = $1", tenant.id)
    return {"callback_url": row["callback_url"], "signing_secret": row["webhook_secret"]}


@router.put("/webhook")
async def put_webhook(body: WebhookIn, tenant: TenantDep, pool: PoolDep) -> dict[str, Any]:
    """Set or clear the callback URL. A tenant without a signing secret gets one
    here, so every callback it receives can be verified."""
    if body.callback_url is not None and not is_valid_callback_url(body.callback_url):
        raise validation_error(
            [{"field": "callback_url", "code": "INVALID_VALUE", "message": "Must be an http or https URL."}]
        )
    row = await pool.fetchrow(
        """
        UPDATE tenants SET callback_url = $2, webhook_secret = COALESCE(webhook_secret, $3)
        WHERE id = $1
        RETURNING callback_url, webhook_secret
        """,
        tenant.id,
        body.callback_url,
        "whsec_" + secrets.token_urlsafe(32),
    )
    return {"callback_url": row["callback_url"], "signing_secret": row["webhook_secret"]}
