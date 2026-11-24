from collections.abc import AsyncIterator
from contextlib import AsyncExitStack
from dataclasses import replace
from typing import Any

import httpx
import pytest

from mock_carrier.carrier import create_app
from support import QUIET, FakeGateway, StartCarrier


@pytest.fixture
def gateway() -> FakeGateway:
    return FakeGateway()


@pytest.fixture
async def start_carrier(gateway: FakeGateway) -> AsyncIterator[StartCarrier]:
    """Start a carrier whose DLRs go to the fake gateway. Keyword arguments override QUIET."""
    async with AsyncExitStack() as stack:

        async def start(**overrides: Any) -> httpx.AsyncClient:
            app = create_app(replace(QUIET, **overrides), transport=httpx.MockTransport(gateway))
            # ASGITransport does not run lifespan events, so run them here.
            await stack.enter_async_context(app.router.lifespan_context(app))
            return await stack.enter_async_context(
                httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://carrier.test")
            )

        yield start
