"""The mock carrier app. Run with: uvicorn mock_carrier.carrier:app --port 9000"""

import random
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated, Literal

import httpx
from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from mock_carrier.config import CarrierConfig
from mock_carrier.dlr import DlrSender
from mock_carrier.stats import CarrierStats
from mock_carrier.submit import SubmitHandler

DLR_HTTP_TIMEOUT_SECONDS = 5.0


class SubmitRequest(BaseModel):
    message_id: str = Field(min_length=1)
    to: str
    sender: str = Field(alias="from")
    text: str
    encoding: Literal["GSM7", "UCS2"]


def _handler(request: Request) -> SubmitHandler:
    return request.app.state.handler


def _stats(request: Request) -> CarrierStats:
    return request.app.state.stats


def create_app(
    config: CarrierConfig | None = None,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> FastAPI:
    """Build the app. `transport` replaces the network for DLR calls (used by tests)."""
    config = config or CarrierConfig.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        rng = random.Random(config.random_seed)
        stats = CarrierStats()
        async with httpx.AsyncClient(transport=transport, timeout=DLR_HTTP_TIMEOUT_SECONDS) as client:
            dlr = DlrSender(client, config, stats, rng)
            app.state.stats = stats
            app.state.handler = SubmitHandler(config, dlr, stats, rng)
            try:
                yield
            finally:
                # Before the client closes, so no pending DLR wakes up to a closed client.
                await dlr.aclose()

    app = FastAPI(title="Mock carrier", lifespan=lifespan)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request: Request, _error: RequestValidationError) -> JSONResponse:
        return JSONResponse({"error": "INVALID_REQUEST"}, status_code=400)

    @app.post("/submit")
    async def submit(
        body: SubmitRequest, handler: Annotated[SubmitHandler, Depends(_handler)]
    ) -> JSONResponse:
        status_code, payload = await handler.submit(body.message_id)
        return JSONResponse(payload, status_code=status_code)

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/stats")
    async def get_stats(stats: Annotated[CarrierStats, Depends(_stats)]) -> dict[str, int | str | None]:
        return stats.as_dict()

    @app.post("/reset")
    async def reset(handler: Annotated[SubmitHandler, Depends(_handler)]) -> dict[str, str]:
        handler.reset()
        return {"status": "reset"}

    return app


app = create_app()
