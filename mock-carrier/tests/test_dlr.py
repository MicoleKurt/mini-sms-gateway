"""DLR delivery against a gateway that fails: retries, giving up, shutdown."""

import asyncio
import random
from collections.abc import AsyncIterator
from dataclasses import replace

import httpx
import pytest

from mock_carrier.dlr import DlrSender
from mock_carrier.stats import CarrierStats
from support import QUIET, FakeGateway


@pytest.fixture
def stats() -> CarrierStats:
    return CarrierStats()


@pytest.fixture
async def sender(gateway: FakeGateway, stats: CarrierStats) -> AsyncIterator[DlrSender]:
    async with httpx.AsyncClient(transport=httpx.MockTransport(gateway)) as client:
        sender = DlrSender(client, QUIET, stats, random.Random(1), retry_backoff_seconds=(0, 0, 0))
        yield sender
        await sender.aclose()


async def test_5xx_is_retried_until_the_gateway_answers(
    sender: DlrSender, gateway: FakeGateway, stats: CarrierStats
) -> None:
    gateway.statuses.extend([503, 500])

    await sender.send_now("c-1")

    assert len(gateway.requests) == 3
    assert len(set(gateway.bodies)) == 1
    assert (stats.dlrs_sent, stats.dlrs_failed) == (1, 0)


async def test_gives_up_after_three_retries(
    sender: DlrSender, gateway: FakeGateway, stats: CarrierStats
) -> None:
    gateway.statuses.extend([503] * 10)

    await sender.send_now("c-1")

    assert len(gateway.requests) == 4
    assert (stats.dlrs_sent, stats.dlrs_failed) == (0, 1)


async def test_unreachable_gateway_is_retried_then_counted_as_failed(
    sender: DlrSender, gateway: FakeGateway, stats: CarrierStats
) -> None:
    gateway.unreachable = True

    await sender.send_now("c-1")

    assert len(gateway.requests) == 4
    assert (stats.dlrs_sent, stats.dlrs_failed) == (0, 1)


async def test_4xx_is_not_retried(sender: DlrSender, gateway: FakeGateway, stats: CarrierStats) -> None:
    gateway.statuses.append(401)

    await sender.send_now("c-1")

    assert len(gateway.requests) == 1
    assert (stats.dlrs_sent, stats.dlrs_failed) == (0, 1)


async def test_aclose_cancels_dlrs_that_have_not_gone_out(gateway: FakeGateway, stats: CarrierStats) -> None:
    config = replace(QUIET, dlr_min_delay_ms=60_000, dlr_max_delay_ms=60_000)
    async with httpx.AsyncClient(transport=httpx.MockTransport(gateway)) as client:
        sender = DlrSender(client, config, stats, random.Random(1))
        tasks_before = asyncio.all_tasks()
        sender.schedule("c-1")
        sender.schedule("c-2")
        assert len(asyncio.all_tasks()) == len(tasks_before) + 2

        await sender.aclose()

        assert asyncio.all_tasks() == tasks_before
    assert gateway.requests == []
    assert (stats.dlrs_sent, stats.dlrs_failed) == (0, 0)
