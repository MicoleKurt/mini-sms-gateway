"""The internal API behind the dashboard. Guarded by X-Admin-Token, sees all tenants."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import JSONResponse, StreamingResponse

from gateway import metrics, queries
from gateway.accept import accept_messages
from gateway.api.deps import PoolDep, PricesDep, PublisherDep, SettingsDep, get_hub, require_admin
from gateway.api.tenant import StatusFilter, accept_response, as_utc, parse_message_id
from gateway.errors import not_found
from gateway.live import LiveHub
from gateway.messages import event_json, iso, message_json
from gateway.models import MessageIn, Tenant
from gateway.webhooks import webhook_json

router = APIRouter(prefix="/internal", tags=["internal"], dependencies=[Depends(require_admin)])


@router.get("/tenants")
async def list_tenants(pool: PoolDep) -> dict[str, Any]:
    return {"data": await queries.tenant_summaries(pool)}


@router.get("/prices")
async def list_prices(prices: PricesDep) -> dict[str, Any]:
    table = await prices.get()
    return {
        "data": [
            {
                "prefix": p.prefix,
                "country": p.country,
                "price_per_segment_micros": p.price_per_segment_micros,
            }
            for p in table.all()
        ]
    }


@router.get("/messages")
async def list_messages(
    pool: PoolDep,
    tenant_id: uuid.UUID | None = None,
    status: StatusFilter | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    q: Annotated[str | None, Query(max_length=128)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    cursor: str | None = None,
) -> dict[str, Any]:
    rows, next_cursor = await queries.list_messages(
        pool,
        tenant_id=tenant_id,
        status=status,
        created_from=as_utc(created_from),
        created_to=as_utc(created_to),
        search=q.strip() if q else None,
        limit=limit,
        cursor=cursor,
    )
    return {"data": [message_json(r, internal=True) for r in rows], "next_cursor": next_cursor}


@router.get("/messages/{message_id}")
async def get_message(message_id: str, pool: PoolDep) -> dict[str, Any]:
    row = await queries.get_message(pool, parse_message_id(message_id), tenant_id=None)
    if row is None:
        raise not_found("Message")
    mid = row["id"]
    events = await queries.message_events(pool, mid)
    attempts = await pool.fetch(
        """
        SELECT attempt_no, worker_id, started_at, finished_at, outcome, http_status, carrier_id, error
        FROM submit_attempts WHERE message_id = $1 ORDER BY attempt_no
        """,
        mid,
    )
    dlrs = await pool.fetch(
        """
        SELECT id, carrier_id, status, carrier_timestamp, received_at, disposition
        FROM dlr_receipts WHERE message_id = $1 ORDER BY id
        """,
        mid,
    )
    ledger = await pool.fetch(
        """
        SELECT id, message_id, kind, amount_micros, balance_after_micros, created_at
        FROM ledger_entries WHERE message_id = $1 ORDER BY id
        """,
        mid,
    )
    webhooks = await pool.fetch("SELECT * FROM webhook_deliveries WHERE message_id = $1", mid)
    return {
        "message": message_json(row, internal=True),
        "events": [event_json(e) for e in events],
        "attempts": [
            {
                "attempt_no": a["attempt_no"],
                "worker_id": a["worker_id"],
                "started_at": iso(a["started_at"]),
                "finished_at": iso(a["finished_at"]),
                "outcome": a["outcome"],
                "http_status": a["http_status"],
                "carrier_id": a["carrier_id"],
                "error": a["error"],
            }
            for a in attempts
        ],
        "dlrs": [
            {
                "id": d["id"],
                "carrier_id": d["carrier_id"],
                "status": d["status"],
                "carrier_timestamp": iso(d["carrier_timestamp"]),
                "received_at": iso(d["received_at"]),
                "disposition": d["disposition"],
            }
            for d in dlrs
        ],
        "ledger": [queries.ledger_json(entry) for entry in ledger],
        "webhooks": [webhook_json(w) for w in webhooks],
    }


@router.post("/tenants/{tenant_id}/messages", status_code=202)
async def send_as_tenant(
    tenant_id: uuid.UUID,
    body: MessageIn,
    pool: PoolDep,
    prices: PricesDep,
    settings: SettingsDep,
    publisher: PublisherDep,
    idempotency_key: Annotated[str | None, Header()] = None,
) -> JSONResponse:
    """The dashboard's "send test message". Same function as the tenant API,
    so a test message is validated, priced, charged and queued like a real one."""
    row = await pool.fetchrow("SELECT id, slug, name, currency FROM tenants WHERE id = $1", tenant_id)
    if row is None:
        raise not_found("Tenant")
    tenant = Tenant(id=row["id"], slug=row["slug"], name=row["name"], currency=row["currency"])
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
        metrics.MESSAGES_ACCEPTED.labels(tenant.slug).inc()
        await publisher.publish_all(result.live_events)
    return accept_response(result)


@router.get("/overview")
async def overview(pool: PoolDep, settings: SettingsDep) -> dict[str, Any]:
    return {
        "queue": await queries.queue_stats(pool),
        "carrier": {
            "limit_per_second": settings.carrier_rate_limit,
            "target_per_second": round(settings.carrier_target_rate, 2),
        },
        "throughput": await queries.throughput(pool, seconds=60),
        "billing": await queries.billing_checks(pool),
        "webhooks": await queries.webhook_counts(pool),
    }


@router.get("/stream")
async def stream(
    hub: Annotated[LiveHub, Depends(get_hub)], tenant_id: uuid.UUID | None = None
) -> StreamingResponse:
    return StreamingResponse(
        hub.stream(str(tenant_id) if tenant_id else None),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            # Tells a reverse proxy (nginx) not to buffer the stream.
            "X-Accel-Buffering": "no",
        },
    )
