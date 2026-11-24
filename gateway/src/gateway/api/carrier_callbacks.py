"""POST /carrier/dlr: delivery receipts pushed by the carrier."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Request

from gateway import dlr, metrics
from gateway.api.deps import PoolDep, PublisherDep, SettingsDep
from gateway.errors import ApiError, validation_error
from gateway.status import DLR_STATUS

router = APIRouter(tags=["carrier"])

MAX_CARRIER_ID = 128


@router.post("/carrier/dlr")
async def carrier_dlr(
    request: Request, pool: PoolDep, settings: SettingsDep, publisher: PublisherDep
) -> dict[str, Any]:
    # The signature covers the raw bytes, so read them before anything parses
    # or re-serialises the body, and check it before the body is trusted at all.
    raw = await request.body()
    if not dlr.signature_is_valid(settings.dlr_secret, raw, request.headers.get("x-signature")):
        metrics.DLR_RECEIVED.labels("rejected").inc()
        raise ApiError(401, "INVALID_SIGNATURE", "Missing or invalid X-Signature.")

    carrier_id, status, timestamp = _parse(raw)
    result = await dlr.ingest(pool, carrier_id, status, timestamp)

    metrics.DLR_RECEIVED.labels(result.result).inc()
    for change in result.changes:
        message = change.message
        metrics.MESSAGES_FINAL.labels(message["status"]).inc()
        if message["submitted_at"] and message["finalized_at"]:
            metrics.DLR_DELAY_SECONDS.observe(
                (message["finalized_at"] - message["submitted_at"]).total_seconds()
            )
    await publisher.publish_changes(result.changes)
    # 200 for a duplicate and for an early DLR too: it is stored, the carrier
    # must not send it again.
    return {"result": result.result}


def _parse(raw: bytes) -> tuple[str, str, datetime]:
    try:
        body = json.loads(raw)
    except ValueError as exc:
        raise validation_error(
            [{"field": "body", "code": "INVALID_VALUE", "message": "Body is not valid JSON."}]
        ) from exc
    if not isinstance(body, dict):
        raise validation_error(
            [{"field": "body", "code": "INVALID_VALUE", "message": "Body must be an object."}]
        )

    errors: list[dict[str, Any]] = []
    carrier_id = body.get("carrier_id")
    if (
        not isinstance(carrier_id, str)
        or not (1 <= len(carrier_id) <= MAX_CARRIER_ID)
        or "\x00" in carrier_id
    ):
        errors.append(
            {"field": "carrier_id", "code": "INVALID_VALUE", "message": "Must be a non-empty string."}
        )

    status = body.get("status")
    if not isinstance(status, str) or status not in DLR_STATUS:
        errors.append(
            {"field": "status", "code": "INVALID_VALUE", "message": "Must be DELIVRD, UNDELIV or EXPIRED."}
        )

    timestamp: datetime | None = None
    raw_timestamp = body.get("timestamp")
    if isinstance(raw_timestamp, str):
        try:
            timestamp = datetime.fromisoformat(raw_timestamp)
        except ValueError:
            timestamp = None
    if timestamp is None:
        errors.append({"field": "timestamp", "code": "INVALID_VALUE", "message": "Must be an ISO 8601 time."})
    elif timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=UTC)

    if errors:
        raise validation_error(errors)
    assert isinstance(carrier_id, str) and isinstance(status, str) and timestamp is not None
    return carrier_id, status, timestamp
