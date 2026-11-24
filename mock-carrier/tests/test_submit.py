import asyncio
import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta

import httpx
import pytest

from support import SECRET, FakeGateway, StartCarrier, message

STATS_KEYS = [
    "received",
    "accepted",
    "rate_limited",
    "temporary_failures",
    "permanent_failures",
    "timeouts",
    "unique_message_ids_accepted",
    "duplicate_accepts",
    "dlrs_sent",
    "dlrs_failed",
    "max_submits_in_one_second",
    "first_submit_at",
    "last_submit_at",
]


async def stats_of(carrier: httpx.AsyncClient) -> dict:
    return (await carrier.get("/stats")).json()


async def test_accepted_submit_returns_carrier_id_and_sends_a_signed_dlr(
    start_carrier: StartCarrier, gateway: FakeGateway
) -> None:
    carrier = await start_carrier()

    response = await carrier.post("/submit", json=message())
    await gateway.wait_for_requests(1)

    assert response.status_code == 200
    carrier_id = response.json()["carrier_id"]
    assert carrier_id.startswith("c-")
    int(carrier_id.removeprefix("c-"), 16)

    request = gateway.requests[0]
    assert request.method == "POST"
    assert str(request.url) == "http://gateway.test/carrier/dlr"
    assert request.headers["content-type"] == "application/json"
    expected_signature = hmac.new(SECRET.encode(), request.content, hashlib.sha256).hexdigest()
    assert request.headers["x-signature"] == expected_signature

    dlr = json.loads(request.content)
    assert set(dlr) == {"carrier_id", "status", "timestamp"}
    assert dlr["carrier_id"] == carrier_id
    assert dlr["status"] == "DELIVRD"
    assert dlr["timestamp"].endswith("Z")
    assert datetime.fromisoformat(dlr["timestamp"]).utcoffset() == timedelta(0)


@pytest.mark.parametrize(
    ("shares", "status"),
    [
        ({"p_delivrd": 1.0, "p_undeliv": 0.0, "p_expired": 0.0}, "DELIVRD"),
        ({"p_delivrd": 0.0, "p_undeliv": 1.0, "p_expired": 0.0}, "UNDELIV"),
        ({"p_delivrd": 0.0, "p_undeliv": 0.0, "p_expired": 1.0}, "EXPIRED"),
    ],
)
async def test_dlr_status_follows_the_configured_mix(
    start_carrier: StartCarrier, gateway: FakeGateway, shares: dict[str, float], status: str
) -> None:
    carrier = await start_carrier(**shares)

    await carrier.post("/submit", json=message())
    await gateway.wait_for_requests(1)

    assert json.loads(gateway.bodies[0])["status"] == status


@pytest.mark.parametrize("missing", ["message_id", "to", "from", "text", "encoding"])
async def test_missing_field_is_400_and_is_not_a_submit(
    start_carrier: StartCarrier, gateway: FakeGateway, missing: str
) -> None:
    carrier = await start_carrier()
    body = message()
    del body[missing]

    response = await carrier.post("/submit", json=body)

    assert response.status_code == 400
    assert response.json() == {"error": "INVALID_REQUEST"}
    stats = await stats_of(carrier)
    assert stats["received"] == 0
    assert stats["max_submits_in_one_second"] == 0
    assert gateway.requests == []


@pytest.mark.parametrize(
    "body",
    [b"not json", b"[]", json.dumps(message() | {"encoding": "ASCII"}).encode()],
    ids=["not json", "not an object", "unknown encoding"],
)
async def test_malformed_body_is_400(start_carrier: StartCarrier, body: bytes) -> None:
    carrier = await start_carrier()

    response = await carrier.post("/submit", content=body, headers={"Content-Type": "application/json"})

    assert response.status_code == 400
    assert response.json() == {"error": "INVALID_REQUEST"}
    assert (await stats_of(carrier))["received"] == 0


async def test_submit_over_the_rate_limit_is_429_and_is_not_counted(
    start_carrier: StartCarrier, gateway: FakeGateway
) -> None:
    carrier = await start_carrier(rate_limit_per_sec=50)

    started = time.monotonic()
    responses = [await carrier.post("/submit", json=message(f"m-{n}")) for n in range(51)]
    assert time.monotonic() - started < 1.0, "the 51 submits must land inside one second"
    await gateway.wait_for_requests(50)

    assert [response.status_code for response in responses[:50]] == [200] * 50
    assert responses[50].status_code == 429
    assert responses[50].json() == {"error": "RATE_LIMITED"}
    stats = await stats_of(carrier)
    assert stats["received"] == 51
    assert stats["accepted"] == 50
    assert stats["rate_limited"] == 1
    assert stats["max_submits_in_one_second"] == 50
    assert len(gateway.requests) == 50


async def test_rate_limit_is_checked_before_the_random_outcome(start_carrier: StartCarrier) -> None:
    carrier = await start_carrier(rate_limit_per_sec=1, p_temporary_failure=1.0)

    first = await carrier.post("/submit", json=message("m-1"))
    second = await carrier.post("/submit", json=message("m-2"))

    assert first.status_code == 503
    assert second.status_code == 429
    stats = await stats_of(carrier)
    assert stats["temporary_failures"] == 1
    assert stats["rate_limited"] == 1


@pytest.mark.parametrize(
    ("share", "status_code", "error", "counter"),
    [
        ("p_temporary_failure", 503, "TEMPORARY_FAILURE", "temporary_failures"),
        ("p_permanent_failure", 400, "INVALID_DESTINATION", "permanent_failures"),
    ],
)
async def test_failed_submit_is_not_accepted_and_sends_no_dlr(
    start_carrier: StartCarrier, gateway: FakeGateway, share: str, status_code: int, error: str, counter: str
) -> None:
    carrier = await start_carrier(**{share: 1.0})

    response = await carrier.post("/submit", json=message())
    # DLR delay is zero in this config, so a DLR sent by mistake would be here by now.
    await asyncio.sleep(0.05)

    assert response.status_code == status_code
    assert response.json() == {"error": error}
    stats = await stats_of(carrier)
    assert stats[counter] == 1
    assert stats["accepted"] == 0
    assert stats["dlrs_sent"] == 0
    assert gateway.requests == []


async def test_timeout_is_accepted_sends_a_dlr_and_answers_504(
    start_carrier: StartCarrier, gateway: FakeGateway
) -> None:
    carrier = await start_carrier(p_timeout=1.0, timeout_seconds=0.1)

    started = time.perf_counter()
    response = await carrier.post("/submit", json=message())
    elapsed = time.perf_counter() - started
    await gateway.wait_for_requests(1)

    assert response.status_code == 504
    assert response.json() == {"error": "TIMEOUT"}
    # Loose bound: the event loop clock on Windows ticks every 15 ms or so.
    assert elapsed >= 0.07
    assert json.loads(gateway.bodies[0])["carrier_id"].startswith("c-")
    stats = await stats_of(carrier)
    assert stats["timeouts"] == 1
    assert stats["accepted"] == 1
    assert stats["unique_message_ids_accepted"] == 1
    assert stats["dlrs_sent"] == 1


async def test_duplicate_dlr_is_sent_twice_with_identical_bytes(
    start_carrier: StartCarrier, gateway: FakeGateway
) -> None:
    carrier = await start_carrier(p_dlr_duplicate=1.0)

    await carrier.post("/submit", json=message())
    await gateway.wait_for_requests(2)

    first, second = gateway.requests
    assert first.content == second.content
    assert first.headers["x-signature"] == second.headers["x-signature"]
    stats = await stats_of(carrier)
    assert stats["accepted"] == 1
    assert stats["dlrs_sent"] == 2


async def test_early_dlr_is_answered_before_the_submit_response(
    start_carrier: StartCarrier, gateway: FakeGateway
) -> None:
    gateway.answer_delay_seconds = 0.05
    # A DLR delay of one minute shows that the early case ignores the delay range.
    carrier = await start_carrier(p_dlr_early=1.0, dlr_min_delay_ms=60_000, dlr_max_delay_ms=60_000)

    response = await carrier.post("/submit", json=message())
    gateway.events.append("submit answered")

    assert response.status_code == 200
    assert gateway.events == ["dlr answered", "submit answered"]
    assert json.loads(gateway.bodies[0])["carrier_id"] == response.json()["carrier_id"]


async def test_normal_dlr_does_not_hold_up_the_submit_response(
    start_carrier: StartCarrier, gateway: FakeGateway
) -> None:
    gateway.answer_delay_seconds = 0.05
    carrier = await start_carrier()

    response = await carrier.post("/submit", json=message())
    gateway.events.append("submit answered")
    await gateway.wait_for_requests(1)

    assert response.status_code == 200
    assert gateway.events == ["submit answered", "dlr answered"]


async def test_response_takes_the_configured_latency(start_carrier: StartCarrier) -> None:
    carrier = await start_carrier(min_latency_ms=100, max_latency_ms=100)

    started = time.perf_counter()
    response = await carrier.post("/submit", json=message())
    elapsed = time.perf_counter() - started

    assert response.status_code == 200
    assert elapsed >= 0.07


async def test_repeated_message_id_is_accepted_again_by_default(
    start_carrier: StartCarrier, gateway: FakeGateway
) -> None:
    carrier = await start_carrier()

    first = await carrier.post("/submit", json=message("m-1"))
    second = await carrier.post("/submit", json=message("m-1"))
    await gateway.wait_for_requests(2)

    assert first.json()["carrier_id"] != second.json()["carrier_id"]
    stats = await stats_of(carrier)
    assert stats["accepted"] == 2
    assert stats["unique_message_ids_accepted"] == 1
    assert stats["duplicate_accepts"] == 1
    assert stats["dlrs_sent"] == 2


async def test_idempotent_submit_returns_the_first_carrier_id_and_sends_one_dlr(
    start_carrier: StartCarrier, gateway: FakeGateway
) -> None:
    carrier = await start_carrier(idempotent_submit=True)

    first = await carrier.post("/submit", json=message("m-1"))
    second = await carrier.post("/submit", json=message("m-1"))
    await gateway.wait_for_requests(1)
    await asyncio.sleep(0.05)

    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert len(gateway.requests) == 1
    stats = await stats_of(carrier)
    assert stats["received"] == 2
    assert stats["accepted"] == 1
    assert stats["duplicate_accepts"] == 0
    assert stats["dlrs_sent"] == 1


async def test_idempotent_submit_recovers_the_carrier_id_lost_to_a_timeout(
    start_carrier: StartCarrier, gateway: FakeGateway
) -> None:
    carrier = await start_carrier(idempotent_submit=True, p_timeout=1.0)

    timed_out = await carrier.post("/submit", json=message("m-1"))
    retried = await carrier.post("/submit", json=message("m-1"))
    await gateway.wait_for_requests(1)

    assert timed_out.status_code == 504
    assert retried.status_code == 200
    assert retried.json()["carrier_id"] == json.loads(gateway.bodies[0])["carrier_id"]


async def test_stats_have_the_contract_shape(start_carrier: StartCarrier) -> None:
    carrier = await start_carrier()

    empty = await stats_of(carrier)
    await carrier.post("/submit", json=message("m-1"))
    await carrier.post("/submit", json=message("m-2"))
    after = await stats_of(carrier)

    assert list(empty) == STATS_KEYS
    assert empty["first_submit_at"] is None
    assert empty["last_submit_at"] is None
    assert datetime.fromisoformat(after["first_submit_at"]) <= datetime.fromisoformat(after["last_submit_at"])
    assert after["max_submits_in_one_second"] == 2


async def test_reset_clears_counters_and_accepted_ids(
    start_carrier: StartCarrier, gateway: FakeGateway
) -> None:
    carrier = await start_carrier(idempotent_submit=True)
    before = await carrier.post("/submit", json=message("m-1"))
    await gateway.wait_for_requests(1)

    reset = await carrier.post("/reset")
    cleared = await stats_of(carrier)
    after = await carrier.post("/submit", json=message("m-1"))

    assert reset.status_code == 200
    assert all(value in (0, None) for value in cleared.values())
    # The message ID was forgotten, so it is accepted as new.
    assert after.json()["carrier_id"] != before.json()["carrier_id"]
    assert (await stats_of(carrier))["unique_message_ids_accepted"] == 1


async def test_same_seed_gives_the_same_outcomes(start_carrier: StartCarrier) -> None:
    async def outcomes() -> list[int]:
        carrier = await start_carrier(p_temporary_failure=0.5, random_seed=7)
        return [(await carrier.post("/submit", json=message(f"m-{n}"))).status_code for n in range(40)]

    first, second = await outcomes(), await outcomes()

    assert first == second
    assert set(first) == {200, 503}


async def test_healthz(start_carrier: StartCarrier) -> None:
    carrier = await start_carrier()

    response = await carrier.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
