"""The webhook sink app. Run with: uvicorn mock_carrier.sink:app --port 9100"""

import asyncio
import random
from dataclasses import asdict, dataclass

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from mock_carrier.clock import utc_now_iso
from mock_carrier.config import SinkConfig


@dataclass
class TenantStats:
    received: int = 0
    failed: int = 0
    last_received_at: str | None = None


def create_app(config: SinkConfig | None = None) -> FastAPI:
    config = config or SinkConfig.from_env()
    rng = random.Random()
    tenants: dict[str, TenantStats] = {}

    app = FastAPI(title="Webhook sink")

    @app.post("/hooks/{tenant_slug}")
    async def receive(tenant_slug: str) -> JSONResponse:
        """Record the call. Nothing is verified: not the signature, not the body."""
        behaviour = config.behaviour_for(tenant_slug)
        stats = tenants.setdefault(tenant_slug, TenantStats())
        stats.received += 1
        stats.last_received_at = utc_now_iso()

        await asyncio.sleep(rng.uniform(*behaviour.delay_ms) / 1000)
        if rng.random() < behaviour.fail_share:
            stats.failed += 1
            return JSONResponse({"error": "SINK_FAILURE"}, status_code=500)
        return JSONResponse({"status": "ok"})

    @app.get("/stats")
    async def get_stats() -> dict[str, dict[str, dict[str, int | str | None]]]:
        return {"tenants": {slug: asdict(counters) for slug, counters in tenants.items()}}

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
