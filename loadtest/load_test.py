# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx"]
# ///
"""Load test for the SMS gateway.

Sends a ShopFast campaign in batches and, at the same time, one Acme Bank OTP
per interval. When every message of the run is final it prints the total time,
the submit rate, the OTP accept-to-SUBMITTED latency, the final state counts
and a billing check that is computed here from the ledger.

Only public HTTP APIs are used: the gateway tenant API and, optionally, the
mock carrier's /stats and /reset. See loadtest/README.md.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import hashlib
import math
import os
import re
import secrets
import sys
import time
from collections import Counter, defaultdict
from collections.abc import AsyncIterator, Iterable, Iterator, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

Json = dict[str, Any]

NON_FINAL_STATUSES = ("ACCEPTED", "QUEUED", "SUBMITTED")
FINAL_STATUSES = ("DELIVERED", "UNDELIVERED", "EXPIRED", "FAILED")
ALL_STATUSES = (*NON_FINAL_STATUSES, *FINAL_STATUSES)

DEFAULT_SHOPFAST_KEY = "sk_shop_dev_8e2b6a4f1c9d7053"
DEFAULT_ACME_KEY = "sk_acme_dev_3f9c1d7e5b2a4c68"

CAMPAIGN_SENDER = "SHOPFAST"
CAMPAIGN_TEXT = (
    "ShopFast: Flash sale this weekend only. Get 20% off everything "
    "with code SAVE20 at checkout. Reply STOP to opt out."
)
OTP_SENDER = "ACME"

# The carrier does not report its configured limit, so the assignment's value is used.
CARRIER_LIMIT_PER_SECOND = 50

MAX_RETRIES = 5
RETRY_BASE_DELAY_SECONDS = 0.5
REQUEST_TIMEOUT_SECONDS = 60.0
PAGE_SIZE = 1000
DETAIL_CONCURRENCY = 10
PROGRESS_INTERVAL_SECONDS = 5.0
POLL_INTERVAL_SECONDS = 1.0

# The message list is filtered by created_from using this machine's clock, while
# created_at comes from the gateway's. The allowance keeps the run's first
# messages in the window if the clocks disagree; the client_ref prefix is what
# actually selects this run's messages.
CLOCK_SKEW_ALLOWANCE = timedelta(seconds=60)

EXIT_OK = 0
EXIT_CHECK_FAILED = 1
EXIT_ABORTED = 2


class LoadTestError(Exception):
    """The run cannot continue. The message is shown to the user as is."""


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Config:
    gateway_url: str
    carrier_url: str
    shopfast_key: str
    acme_key: str
    messages: int
    batch_size: int
    otp_interval: float
    timeout: float
    run_id: str

    @property
    def ref_prefix(self) -> str:
        """Prefix of client_ref for every message of this run."""
        return f"load-{self.run_id}-"


def _int_in_range(low: int, high: int | None):
    def parse(text: str) -> int:
        value = int(text)
        if value < low or (high is not None and value > high):
            limit = f"between {low} and {high}" if high is not None else f"at least {low}"
            raise argparse.ArgumentTypeError(f"must be {limit}")
        return value

    return parse


def _positive_float(text: str) -> float:
    value = float(text)
    if not (math.isfinite(value) and value > 0):
        raise argparse.ArgumentTypeError("must be greater than 0")
    return value


def _run_id(text: str) -> str:
    # client_ref is limited to 64 characters and the run id is part of it.
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,32}", text):
        raise argparse.ArgumentTypeError("use 1 to 32 characters of A-Z a-z 0-9 _ -")
    return text


def parse_args(argv: Sequence[str]) -> Config:
    parser = argparse.ArgumentParser(
        description="Send a ShopFast campaign and Acme Bank OTPs through the SMS "
        "gateway, wait until every message is final, then print a report.",
    )
    parser.add_argument(
        "--gateway-url",
        default=os.environ.get("GATEWAY_URL", "http://localhost:8000"),
        help="gateway base URL; env GATEWAY_URL (default: %(default)s)",
    )
    parser.add_argument(
        "--carrier-url",
        default=os.environ.get("CARRIER_URL", "http://localhost:9000"),
        help="mock carrier base URL; env CARRIER_URL; an empty string turns the "
        "carrier stats off (default: %(default)s)",
    )
    parser.add_argument(
        "--shopfast-key",
        default=DEFAULT_SHOPFAST_KEY,
        help="ShopFast API key (default: the seeded development key)",
    )
    parser.add_argument(
        "--acme-key",
        default=DEFAULT_ACME_KEY,
        help="Acme Bank API key (default: the seeded development key)",
    )
    parser.add_argument(
        "--messages",
        type=_int_in_range(1, None),
        default=10_000,
        help="campaign messages to send (default: %(default)s)",
    )
    parser.add_argument(
        "--batch-size",
        type=_int_in_range(1, 1000),
        default=1000,
        help="messages per batch request, 1 to 1000 (default: %(default)s)",
    )
    parser.add_argument(
        "--otp-interval",
        type=_positive_float,
        default=1.0,
        help="seconds between OTP messages (default: %(default)s)",
    )
    parser.add_argument(
        "--timeout",
        type=_positive_float,
        default=900.0,
        help="seconds allowed for sending and for every message to become final "
        "(default: %(default)s)",
    )
    parser.add_argument(
        "--run-id",
        type=_run_id,
        default=secrets.token_hex(4),
        help="marks this run's messages in client_ref and in the idempotency keys "
        "(default: 8 random hex characters)",
    )
    args = parser.parse_args(argv)
    return Config(
        gateway_url=args.gateway_url.rstrip("/"),
        carrier_url=args.carrier_url.rstrip("/"),
        shopfast_key=args.shopfast_key,
        acme_key=args.acme_key,
        messages=args.messages,
        batch_size=args.batch_size,
        otp_interval=args.otp_interval,
        timeout=args.timeout,
        run_id=args.run_id,
    )


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------


async def send_with_retry(
    client: httpx.AsyncClient, method: str, path: str, **request: Any
) -> httpx.Response:
    """Send one request; retry network errors and 5xx, fail at once on 4xx.

    Every retry repeats the identical request. That is safe for a GET, and for
    a POST only because the caller sends an Idempotency-Key: if the first try
    was applied and only its response was lost, the gateway replays the stored
    response instead of accepting and charging the messages again.
    """
    failure = ""
    for attempt in range(MAX_RETRIES + 1):
        if attempt:
            print(f"  ! retry {attempt}/{MAX_RETRIES} of {method} {path}: {failure}", flush=True)
            await asyncio.sleep(RETRY_BASE_DELAY_SECONDS * 2 ** (attempt - 1))
        try:
            response = await client.request(method, path, **request)
        except httpx.TransportError as exc:
            failure = f"{type(exc).__name__}: {exc}"
            continue
        if response.is_success:
            return response
        if 400 <= response.status_code < 500:
            raise LoadTestError(f"{method} {path} -> HTTP {response.status_code}: {response.text}")
        failure = f"HTTP {response.status_code}: {response.text[:200]}"
    raise LoadTestError(f"{method} {path} still failing after {MAX_RETRIES} retries: {failure}")


@dataclass(frozen=True)
class TenantApi:
    """The gateway tenant API as seen with one API key."""

    http: httpx.AsyncClient
    api_key: str

    async def get(self, path: str, params: Json | None = None) -> Json:
        response = await send_with_retry(
            self.http, "GET", path, headers={"X-API-Key": self.api_key}, params=params
        )
        return response.json()

    async def post(self, path: str, body: Json, idempotency_key: str) -> Json:
        headers = {"X-API-Key": self.api_key, "Idempotency-Key": idempotency_key}
        response = await send_with_retry(self.http, "POST", path, headers=headers, json=body)
        return response.json()

    async def pages(self, path: str, params: Json) -> AsyncIterator[Json]:
        """Yield every row of a cursor-paginated list."""
        cursor = None
        while True:
            query = params if cursor is None else {**params, "cursor": cursor}
            page = await self.get(path, query)
            for row in page["data"]:
                yield row
            cursor = page["next_cursor"]
            if cursor is None:
                return


@dataclass(frozen=True)
class Tenant:
    """A tenant and its state before the run, used to isolate this run's numbers."""

    api: TenantApi
    slug: str
    balance_before_micros: int
    counts_before: dict[str, int]

    async def counts_since_start(self) -> dict[str, int]:
        stats = await self.api.get("/v1/messages/stats")
        return {s: stats["counts"][s] - self.counts_before[s] for s in ALL_STATUSES}


async def open_tenant(http: httpx.AsyncClient, api_key: str) -> Tenant:
    api = TenantApi(http, api_key)
    balance, stats = await asyncio.gather(api.get("/v1/balance"), api.get("/v1/messages/stats"))
    return Tenant(api, balance["tenant"], balance["balance_micros"], stats["counts"])


async def reset_carrier(carrier: httpx.AsyncClient) -> bool:
    try:
        (await carrier.post("/reset")).raise_for_status()
    except httpx.HTTPError as exc:
        print(
            f"WARNING: could not reset the carrier stats ({type(exc).__name__}: {exc}). "
            "They will include earlier traffic.",
            flush=True,
        )
        return False
    return True


async def fetch_carrier_stats(carrier: httpx.AsyncClient) -> Json | None:
    try:
        response = await carrier.get("/stats")
        response.raise_for_status()
    except httpx.HTTPError as exc:
        print(f"WARNING: could not read the carrier stats ({type(exc).__name__}: {exc}).")
        return None
    return response.json()


# --------------------------------------------------------------------------
# Small pure helpers
# --------------------------------------------------------------------------


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value)


def iso_utc(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def usd(micros: int) -> str:
    """Format integer micros as a decimal USD amount without going through float."""
    whole, fraction = divmod(abs(micros), 1_000_000)
    return f"{'-' if micros < 0 else ''}{whole}.{fraction:06d}"


def percentile(values: Sequence[float], p: float) -> float:
    """Return the p-th percentile (0 < p <= 100) by the nearest-rank method.

    The values are sorted and the one at rank ceil(p / 100 * n), counting from
    1, is returned. The result is therefore always an observed value: nothing
    is interpolated, and it is the smallest value that at least p percent of
    the values do not exceed.
    """
    if not values:
        raise ValueError("percentile of no values")
    if not 0 < p <= 100:
        raise ValueError("p must be in (0, 100]")
    ordered = sorted(values)
    # Multiply before dividing: 95 * 20 / 100 is exactly 19, 0.95 * 20 may not be.
    rank = math.ceil(p * len(ordered) / 100)
    return ordered[rank - 1]


def run_offset(run_id: str) -> int:
    """A stable number derived from the run id, so each run uses its own number range."""
    return int.from_bytes(hashlib.sha256(run_id.encode()).digest()[:8], "big")


def campaign_number(offset: int, index: int) -> str:
    """A Bangladesh mobile number. Distinct for distinct indexes below 10**8."""
    return f"+88017{(offset + index) % 10**8:08d}"


def otp_number(offset: int, index: int) -> str:
    """A United Arab Emirates mobile number. Distinct for distinct indexes below 10**7."""
    return f"+97150{(offset + index) % 10**7:07d}"


def final_count(counts: dict[str, int]) -> int:
    return sum(counts[status] for status in FINAL_STATUSES)


def rate_per_second(count: int, first: datetime | None, last: datetime | None) -> float | None:
    """Average rate over the window from first to last, or None if there is no window."""
    if first is None or last is None or last <= first:
        return None
    return count / (last - first).total_seconds()


def leaf_exceptions(group: BaseExceptionGroup) -> Iterator[BaseException]:
    for exc in group.exceptions:
        if isinstance(exc, BaseExceptionGroup):
            yield from leaf_exceptions(exc)
        else:
            yield exc


# --------------------------------------------------------------------------
# Load phase
# --------------------------------------------------------------------------


@dataclass
class Sent:
    """What the gateway has accepted from this run so far. Shared by the sender tasks."""

    campaign: int = 0
    otp_ids: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class Timing:
    """Seconds since the first request of the load phase."""

    campaign_accepted: float
    campaign_final: float
    all_final: float


async def send_campaign(config: Config, shopfast: TenantApi, sent: Sent) -> None:
    """Hand the whole campaign to the gateway, one batch after another."""
    offset = run_offset(config.run_id)
    for batch_no, start in enumerate(range(0, config.messages, config.batch_size)):
        indexes = range(start, min(start + config.batch_size, config.messages))
        messages = [
            {
                "to": campaign_number(offset, index),
                "from": CAMPAIGN_SENDER,
                "text": CAMPAIGN_TEXT,
                "client_ref": f"{config.ref_prefix}c-{index}",
            }
            for index in indexes
        ]
        reply = await shopfast.post(
            "/v1/messages/batch", {"messages": messages}, f"{config.run_id}-batch-{batch_no}"
        )
        sent.campaign += reply["count"]


async def send_otp(config: Config, acme: TenantApi, offset: int, index: int, sent: Sent) -> None:
    body = {
        "to": otp_number(offset, index),
        "from": OTP_SENDER,
        "text": f"Your Acme Bank code is {secrets.randbelow(10**6):06d}",
        "client_ref": f"{config.ref_prefix}otp-{index}",
    }
    reply = await acme.post("/v1/messages", body, f"{config.run_id}-otp-{index}")
    sent.otp_ids.append(reply["id"])


async def stopped_within(stop: asyncio.Event, seconds: float) -> bool:
    """Wait up to `seconds` for `stop`. Return whether it was set."""
    try:
        async with asyncio.timeout(max(seconds, 0.0)):
            await stop.wait()
    except TimeoutError:
        return False
    return True


async def send_otps(config: Config, acme: TenantApi, stop: asyncio.Event, sent: Sent) -> None:
    """Send one OTP per interval until `stop` is set, then wait for the open requests.

    OTP n is due at start + n * interval and every send is its own task, so a
    slow response neither delays the next OTP nor shifts the schedule.
    """
    offset = run_offset(config.run_id)
    start = time.monotonic()
    index = 0
    async with asyncio.TaskGroup() as sends:
        while True:
            sends.create_task(send_otp(config, acme, offset, index, sent))
            index += 1
            next_due = start + index * config.otp_interval
            if await stopped_within(stop, next_due - time.monotonic()):
                return


async def wait_until_final(tenant: Tenant, expected: int) -> None:
    """Return when `expected` more messages than before the run are in a final status.

    The state lives in the gateway, so the only way to see it change is to poll.
    """
    while True:
        if final_count(await tenant.counts_since_start()) >= expected:
            return
        await asyncio.sleep(POLL_INTERVAL_SECONDS)


def progress_header() -> str:
    return progress_row("elapsed", {status: status for status in ALL_STATUSES}, "OTPs sent")


def progress_row(elapsed: str, counts: dict[str, Any], otps_sent: Any) -> str:
    cells = [f"{counts[status]:>{max(len(status), 6)}}" for status in ALL_STATUSES]
    return f"  {elapsed:>8}  " + "  ".join(cells) + f"  {otps_sent:>9}"


async def print_progress(shopfast: Tenant, sent: Sent, started: float) -> None:
    while True:
        await asyncio.sleep(PROGRESS_INTERVAL_SECONDS)
        counts = await shopfast.counts_since_start()
        elapsed = f"{time.monotonic() - started:.1f}s"
        print(progress_row(elapsed, counts, len(sent.otp_ids)), flush=True)


async def run_load(config: Config, shopfast: Tenant, acme: Tenant, sent: Sent) -> Timing:
    """Send the campaign and the OTPs, and return once every message is final."""
    stop_otps = asyncio.Event()
    started = time.monotonic()
    async with asyncio.TaskGroup() as tasks:
        otps = tasks.create_task(send_otps(config, acme.api, stop_otps, sent))
        progress = tasks.create_task(print_progress(shopfast, sent, started))

        await send_campaign(config, shopfast.api, sent)
        campaign_accepted = time.monotonic() - started
        await wait_until_final(shopfast, sent.campaign)
        campaign_final = time.monotonic() - started

        stop_otps.set()
        await otps
        await wait_until_final(acme, len(sent.otp_ids))
        all_final = time.monotonic() - started
        progress.cancel()
    return Timing(campaign_accepted, campaign_final, all_final)


async def timeout_message(config: Config, shopfast: Tenant, acme: Tenant, sent: Sent) -> str:
    shop_final = final_count(await shopfast.counts_since_start())
    acme_final = final_count(await acme.counts_since_start())
    return (
        f"timed out after {config.timeout:g} s. Final so far: "
        f"{shopfast.slug} {shop_final} of {sent.campaign} accepted, "
        f"{acme.slug} {acme_final} of {len(sent.otp_ids)} accepted."
    )


# --------------------------------------------------------------------------
# Collecting results
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class RunMessage:
    id: str
    status: str
    cost_micros: int
    attempts: int
    submitted_at: datetime | None


@dataclass(frozen=True)
class LedgerEntry:
    message_id: str
    kind: str
    amount_micros: int
    balance_after_micros: int


@dataclass(frozen=True)
class TenantRun:
    """One tenant's part of this run: what was accepted and what the API lists now."""

    slug: str
    accepted: int
    messages: list[RunMessage]


@dataclass(frozen=True)
class SubmitSummary:
    attempts: int
    submitted: int
    first_submitted_at: datetime | None
    last_submitted_at: datetime | None


@dataclass(frozen=True)
class Check:
    name: str
    passed: bool
    detail: str


@dataclass(frozen=True)
class BillingAudit:
    slug: str
    balance_before_micros: int
    balance: Json
    ledger_entries: int
    checks: list[Check]


async def fetch_run_messages(api: TenantApi, ref_prefix: str, since: datetime) -> list[RunMessage]:
    params = {"created_from": iso_utc(since), "limit": PAGE_SIZE}
    return [
        RunMessage(
            id=row["id"],
            status=row["status"],
            cost_micros=row["cost_micros"],
            attempts=row["attempts"],
            submitted_at=parse_time(row["submitted_at"]) if row["submitted_at"] else None,
        )
        async for row in api.pages("/v1/messages", params)
        if (row["client_ref"] or "").startswith(ref_prefix)
    ]


def accept_to_submit_ms(message: Json) -> float | None:
    """Milliseconds from the ACCEPTED event to the SUBMITTED event, or None if never submitted."""
    occurred = {event["status"]: parse_time(event["occurred_at"]) for event in message["events"]}
    if "SUBMITTED" not in occurred:
        return None
    # The contract does not promise an ACCEPTED event; created_at is the same moment.
    accepted_at = occurred.get("ACCEPTED", parse_time(message["created_at"]))
    return (occurred["SUBMITTED"] - accepted_at).total_seconds() * 1000


async def fetch_otp_latencies(acme: TenantApi, otp_ids: Sequence[str]) -> list[float | None]:
    limit = asyncio.Semaphore(DETAIL_CONCURRENCY)

    async def latency(message_id: str) -> float | None:
        async with limit:
            return accept_to_submit_ms(await acme.get(f"/v1/messages/{message_id}"))

    return await asyncio.gather(*(latency(message_id) for message_id in otp_ids))


def summarise_submits(messages: Sequence[RunMessage]) -> SubmitSummary:
    submitted = [m.submitted_at for m in messages if m.submitted_at is not None]
    return SubmitSummary(
        attempts=sum(m.attempts for m in messages),
        submitted=len(submitted),
        first_submitted_at=min(submitted, default=None),
        last_submitted_at=max(submitted, default=None),
    )


def fully_refunded(charges: Sequence[int], refunds: Sequence[int]) -> bool:
    return len(charges) == 1 and list(refunds) == [-charges[0]]


def check_billing(
    balance: Json, ledger: Sequence[LedgerEntry], messages: Sequence[RunMessage]
) -> list[Check]:
    """Check the tenant's money from its ledger. Nothing is taken on the gateway's word.

    The first three checks and the last cover the tenant's whole ledger; the
    "run:" checks need message statuses, so they cover this run's messages.
    """
    amounts: dict[tuple[str, str], list[int]] = defaultdict(list)
    for entry in ledger:
        amounts[(entry.message_id, entry.kind)].append(entry.amount_micros)

    def entries(message_id: str, kind: str) -> list[int]:
        return amounts.get((message_id, kind), [])

    def repeated(kind: str) -> int:
        return sum(1 for (_, k), found in amounts.items() if k == kind and len(found) > 1)

    opening = balance["opening_balance_micros"]
    current = balance["balance_micros"]
    ledger_sum = sum(entry.amount_micros for entry in ledger)
    lowest = min([current, *(entry.balance_after_micros for entry in ledger)])

    failed = [m for m in messages if m.status == "FAILED"]
    charge_wrong = [m for m in messages if entries(m.id, "CHARGE") != [m.cost_micros]]
    refund_wrong = [
        m for m in failed if not fully_refunded(entries(m.id, "CHARGE"), entries(m.id, "REFUND"))
    ]
    refund_stray = [m for m in messages if m.status != "FAILED" and entries(m.id, "REFUND")]

    return [
        Check(
            "balance = opening balance - ledger sum",
            current == opening - ledger_sum,
            f"{usd(current)} = {usd(opening)} - {usd(ledger_sum)}"
            if current == opening - ledger_sum
            else f"balance {usd(current)}, expected {usd(opening - ledger_sum)}",
        ),
        Check(
            "no message charged twice",
            repeated("CHARGE") == 0,
            f"message ids with more than one CHARGE: {repeated('CHARGE')}",
        ),
        Check(
            "no message refunded twice",
            repeated("REFUND") == 0,
            f"message ids with more than one REFUND: {repeated('REFUND')}",
        ),
        Check(
            "run: each message charged once, at its cost",
            not charge_wrong,
            f"{len(charge_wrong)} of {len(messages)} differ",
        ),
        Check(
            "run: each FAILED message refunded once, in full",
            not refund_wrong,
            f"{len(refund_wrong)} of {len(failed)} differ",
        ),
        Check(
            "run: no refund on a message that is not FAILED",
            not refund_stray,
            f"{len(refund_stray)} found",
        ),
        Check("balance never negative", lowest >= 0, f"lowest seen {usd(lowest)}"),
    ]


async def audit_billing(tenant: Tenant, messages: Sequence[RunMessage]) -> BillingAudit:
    ledger = [
        LedgerEntry(
            row["message_id"], row["kind"], row["amount_micros"], row["balance_after_micros"]
        )
        async for row in tenant.api.pages("/v1/ledger", {"limit": PAGE_SIZE})
    ]
    balance = await tenant.api.get("/v1/balance")
    return BillingAudit(
        slug=tenant.slug,
        balance_before_micros=tenant.balance_before_micros,
        balance=balance,
        ledger_entries=len(ledger),
        checks=check_billing(balance, ledger, messages),
    )


# --------------------------------------------------------------------------
# Report
# --------------------------------------------------------------------------


def emit(lines: Iterable[str]) -> None:
    print("\n".join(lines), flush=True)


def section(title: str) -> list[str]:
    return ["", title, "-" * len(title)]


def aligned(rows: Sequence[tuple[str, str]], indent: int = 2) -> list[str]:
    """Format label/value pairs with the values in one column."""
    width = max(len(label) for label, _ in rows)
    return [f"{' ' * indent}{label:<{width}}  {value}" for label, value in rows]


def table(header: Sequence[str], rows: Sequence[Sequence[object]]) -> list[str]:
    """Format rows as text columns: the first left-aligned, the others right-aligned."""
    cells = [[str(cell) for cell in row] for row in (header, *rows)]
    widths = [max(len(row[column]) for row in cells) for column in range(len(header))]
    return [
        "  "
        + "  ".join(
            cell.ljust(width) if column == 0 else cell.rjust(width)
            for column, (cell, width) in enumerate(zip(row, widths, strict=True))
        )
        for row in cells
    ]


def header_lines(config: Config, started_at: datetime) -> list[str]:
    title = "SMS gateway load test"
    return [
        title,
        "=" * len(title),
        *aligned(
            [
                ("Run id", config.run_id),
                ("Started (UTC)", started_at.strftime("%Y-%m-%dT%H:%M:%SZ")),
                ("Gateway", config.gateway_url),
                ("Carrier", config.carrier_url or "not used"),
                ("Campaign", f"{config.messages} ShopFast messages, {config.batch_size} per batch"),
                ("OTP", f"one Acme Bank message every {config.otp_interval:g} s"),
                ("Deadline", f"{config.timeout:g} s"),
            ]
        ),
    ]


def timing_lines(timing: Timing, sent: Sent) -> list[str]:
    return [
        *section("Timing"),
        *aligned(
            [
                (
                    "Campaign accepted by the gateway",
                    f"{timing.campaign_accepted:.1f} s ({sent.campaign} messages)",
                ),
                ("All campaign messages final", f"{timing.campaign_final:.1f} s"),
                (
                    "All messages final (total time)",
                    f"{timing.all_final:.1f} s ({len(sent.otp_ids)} OTPs sent meanwhile)",
                ),
            ]
        ),
    ]


def format_rate(rate: float | None) -> str:
    return "n/a" if rate is None else f"{rate:.1f} per second"


def format_time(moment: datetime | None) -> str:
    return "n/a" if moment is None else iso_utc(moment)


def submit_rate_lines(summary: SubmitSummary) -> list[str]:
    first, last = summary.first_submitted_at, summary.last_submitted_at
    window = f"{(last - first).total_seconds():.1f} s" if first and last else "n/a"
    return [
        *section("Submit rate to the carrier"),
        "  Gateway view (GET /v1/messages, this run's messages)",
        *aligned(
            [
                ("Submit attempts", str(summary.attempts)),
                ("Messages submitted", str(summary.submitted)),
                ("First submitted_at", format_time(first)),
                ("Last submitted_at", format_time(last)),
                ("Window", window),
                ("Average rate", format_rate(rate_per_second(summary.attempts, first, last))),
            ],
            indent=4,
        ),
    ]


def carrier_lines(stats: Json, was_reset: bool) -> list[str]:
    peak = stats["max_submits_in_one_second"]
    # The carrier only counts submits it admitted, so its peak cannot exceed its
    # own limit. A 429 is the evidence that the gateway pushed harder than that.
    within = stats["rate_limited"] == 0 and peak <= CARRIER_LIMIT_PER_SECOND
    verdict = "stayed within" if within else "WENT ABOVE"
    first = parse_time(stats["first_submit_at"]) if stats["first_submit_at"] else None
    last = parse_time(stats["last_submit_at"]) if stats["last_submit_at"] else None
    scope = (
        "since the reset before this run" if was_reset else "reset failed: includes earlier traffic"
    )
    return [
        f"  Carrier view (GET /stats, {scope})",
        *aligned(
            [
                ("received", str(stats["received"])),
                ("accepted", str(stats["accepted"])),
                ("rate_limited (429)", str(stats["rate_limited"])),
                (
                    "max_submits_in_one_second",
                    f"{peak} ({verdict} the limit of {CARRIER_LIMIT_PER_SECOND})",
                ),
                ("timeouts", str(stats["timeouts"])),
                ("duplicate_accepts", str(stats["duplicate_accepts"])),
                ("Average rate", format_rate(rate_per_second(stats["received"], first, last))),
            ],
            indent=4,
        ),
    ]


def otp_latency_lines(latencies: Sequence[float | None]) -> list[str]:
    measured = [value for value in latencies if value is not None]
    rows = [
        ("OTPs accepted", str(len(latencies))),
        ("Never reached SUBMITTED (excluded)", str(len(latencies) - len(measured))),
        ("n", str(len(measured))),
    ]
    if measured:
        rows += [
            ("p50", f"{percentile(measured, 50):.0f} ms"),
            ("p95", f"{percentile(measured, 95):.0f} ms"),
            ("max", f"{max(measured):.0f} ms"),
        ]
    return [*section("OTP latency, accept to SUBMITTED"), *aligned(rows)]


def final_state_lines(runs: Sequence[TenantRun]) -> list[str]:
    counts = [Counter(message.status for message in run.messages) for run in runs]

    def row(label: str, values: Sequence[int]) -> list[object]:
        return [label, *values, sum(values)]

    rows = [row(status, [count[status] for count in counts]) for status in FINAL_STATUSES]
    not_final = [sum(count[status] for status in NON_FINAL_STATUSES) for count in counts]
    if any(not_final):
        rows.append(row("(not final)", not_final))
    rows.append(row("Total", [len(run.messages) for run in runs]))
    rows.append(row("Accepted (202)", [run.accepted for run in runs]))

    lines = [
        *section("Final states (this run)"),
        *table(["Status", *(run.slug for run in runs), "Total"], rows),
    ]
    if any(not_final) or any(len(run.messages) != run.accepted for run in runs):
        lines.append("  WARNING: the messages listed by the API do not match what was accepted.")
    return lines


def money(micros: int) -> str:
    return f"{usd(micros):>14} USD"


def billing_lines(audits: Sequence[BillingAudit]) -> list[str]:
    lines = section("Billing check")
    for audit in audits:
        balance = audit.balance
        lines.append(f"  {audit.slug}")
        lines += aligned(
            [
                ("Opening balance", money(balance["opening_balance_micros"])),
                ("Balance before this run", money(audit.balance_before_micros)),
                ("Balance now", money(balance["balance_micros"])),
                ("Ledger entries read", f"{audit.ledger_entries:>14}"),
                ("Gateway's own 'consistent' flag", f"{str(balance['consistent']).lower():>14}"),
            ],
            indent=4,
        )
        width = max(len(check.name) for check in audit.checks)
        lines += [
            f"    {'PASS' if check.passed else 'FAIL'}  {check.name:<{width}}  ({check.detail})"
            for check in audit.checks
        ]
    return lines


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------


def warn_if_busy(tenants: Sequence[Tenant]) -> None:
    for tenant in tenants:
        in_flight = sum(tenant.counts_before[status] for status in NON_FINAL_STATUSES)
        if in_flight:
            print(
                f"WARNING: {tenant.slug} has {in_flight} messages from earlier traffic that are "
                "not final yet. They can end this run's wait early and distort its numbers.",
                flush=True,
            )


async def run(config: Config) -> int:
    started_at = datetime.now(UTC)
    emit(header_lines(config, started_at))

    async with contextlib.AsyncExitStack() as stack:
        gateway = await stack.enter_async_context(
            httpx.AsyncClient(base_url=config.gateway_url, timeout=REQUEST_TIMEOUT_SECONDS)
        )
        carrier = None
        if config.carrier_url:
            carrier = await stack.enter_async_context(
                httpx.AsyncClient(base_url=config.carrier_url, timeout=REQUEST_TIMEOUT_SECONDS)
            )

        shopfast = await open_tenant(gateway, config.shopfast_key)
        acme = await open_tenant(gateway, config.acme_key)
        warn_if_busy([shopfast, acme])
        carrier_was_reset = carrier is not None and await reset_carrier(carrier)

        emit([*section("Progress (campaign status counts for this run)"), progress_header()])
        sent = Sent()
        try:
            async with asyncio.timeout(config.timeout):
                timing = await run_load(config, shopfast, acme, sent)
        except TimeoutError:
            raise LoadTestError(await timeout_message(config, shopfast, acme, sent)) from None

        since = started_at - CLOCK_SKEW_ALLOWANCE
        shop_messages, acme_messages = await asyncio.gather(
            fetch_run_messages(shopfast.api, config.ref_prefix, since),
            fetch_run_messages(acme.api, config.ref_prefix, since),
        )
        latencies = await fetch_otp_latencies(acme.api, sent.otp_ids)
        carrier_stats = await fetch_carrier_stats(carrier) if carrier is not None else None
        audits = [
            await audit_billing(shopfast, shop_messages),
            await audit_billing(acme, acme_messages),
        ]

    emit(timing_lines(timing, sent))
    emit(submit_rate_lines(summarise_submits([*shop_messages, *acme_messages])))
    if carrier_stats is not None:
        emit(carrier_lines(carrier_stats, carrier_was_reset))
    emit(otp_latency_lines(latencies))
    emit(
        final_state_lines(
            [
                TenantRun(shopfast.slug, sent.campaign, shop_messages),
                TenantRun(acme.slug, len(sent.otp_ids), acme_messages),
            ]
        )
    )
    emit(billing_lines(audits))

    billing_ok = all(check.passed for audit in audits for check in audit.checks)
    emit(["", f"Result: {'PASS' if billing_ok else 'FAIL (billing check)'}"])
    return EXIT_OK if billing_ok else EXIT_CHECK_FAILED


def main() -> int:
    config = parse_args(sys.argv[1:])
    exit_code = EXIT_ABORTED
    try:
        exit_code = asyncio.run(run(config))
    except* LoadTestError as group:
        # Task groups wrap errors, possibly nested; show each cause once.
        for error in leaf_exceptions(group):
            print(f"\nERROR: {error}", file=sys.stderr)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
