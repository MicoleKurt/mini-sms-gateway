# Mini SMS Gateway

A small CPaaS-style SMS gateway: tenants send messages through an API, each
message is charged, queued, submitted to a carrier under a shared rate limit, and
finished by an asynchronous delivery receipt. Built for the Digital Cloud
Communications full stack take-home.

It looks simple from the outside. The work is in what happens when things go
wrong: a retried request, a carrier that times out after accepting, a receipt
that arrives twice or before the submit response, a worker that dies mid-send,
sixty requests racing for the last cent of a balance.

![Overview](docs/screenshots/overview.png)

| Document | What is in it |
|---|---|
| [DESIGN.md](DESIGN.md) | The four design questions, guarantees, fairness, what breaks at 1,000 msg/s, trade-offs |
| [docs/API.md](docs/API.md) | Every endpoint, with request and response bodies |
| [gateway/migrations/001_init.sql](gateway/migrations/001_init.sql) | The schema, with the reason for each constraint and index |

## Run it

```
docker compose up --build
```

That one command starts PostgreSQL, Valkey, the migrations and seed data, the
API, two dispatcher workers, the webhook worker, the mock carrier, a webhook sink
and the dashboard.

| What | Where |
|---|---|
| Dashboard | http://localhost:3000 |
| Gateway API (OpenAPI at `/docs`) | http://localhost:8000 |
| Mock carrier statistics | http://localhost:9000/stats |
| Webhook sink statistics | http://localhost:9100/stats |

Seed data (development values for a local demo, not secrets):

| Tenant | API key | Opening balance |
|---|---|---|
| Acme Bank | `sk_acme_dev_3f9c1d7e5b2a4c68` | 250.00 USD |
| ShopFast | `sk_shop_dev_8e2b6a4f1c9d7053` | 1,000.00 USD |

Prices per segment: `+880` 0.0040, `+971` 0.0210, `+63` 0.0035, `+44` 0.0380,
`+1` 0.0075 USD.

Send a message and read it back:

```
curl -s http://localhost:8000/v1/messages \
  -H "X-API-Key: sk_acme_dev_3f9c1d7e5b2a4c68" \
  -H "Idempotency-Key: demo-1" \
  -H "Content-Type: application/json" \
  -d '{"to": "+8801711000001", "from": "ACME", "text": "Your code is 482913"}'

curl -s http://localhost:8000/v1/messages/<id> -H "X-API-Key: sk_acme_dev_3f9c1d7e5b2a4c68"
```

Run the second command a few seconds later and the `events` array shows the whole
path: `ACCEPTED`, `QUEUED`, `SUBMITTED`, then `DELIVERED`, `UNDELIVERED` or
`EXPIRED`.

## How a message moves

```mermaid
sequenceDiagram
    autonumber
    participant T as Tenant
    participant A as API
    participant P as PostgreSQL
    participant D as Dispatcher
    participant V as Valkey
    participant C as Carrier

    T->>A: POST /v1/messages (Idempotency-Key)
    A->>P: one transaction: key, charge, message QUEUED, ledger
    A-->>T: 202 ACCEPTED
    D->>P: claim one message (fair, SKIP LOCKED, lease, attempt row)
    D->>V: rate-limit token (GCRA)
    D->>C: POST /submit
    C-->>D: 200 carrier_id
    D->>P: SUBMITTED, apply any DLR that came early
    C->>A: POST /carrier/dlr (HMAC signed)
    A->>P: DELIVERED, webhook outbox row
```

```mermaid
stateDiagram-v2
    direction LR
    [*] --> ACCEPTED
    ACCEPTED --> QUEUED: same transaction
    QUEUED --> SUBMITTED: carrier returned a carrier_id
    QUEUED --> QUEUED: 429 / 503 / timeout, retry with backoff
    QUEUED --> FAILED: 400, or no attempts left (refund)
    SUBMITTED --> DELIVERED: DLR DELIVRD
    SUBMITTED --> UNDELIVERED: DLR UNDELIV
    SUBMITTED --> EXPIRED: DLR EXPIRED
    DELIVERED --> [*]
    UNDELIVERED --> [*]
    EXPIRED --> [*]
    FAILED --> [*]
```

A status only moves along these arrows. Each move is a compare-and-set in SQL, so
a late or repeated event finds nothing to update.

## Where each requirement lives

| Requirement | Code | Tests |
|---|---|---|
| Send API, E.164, clear errors | [`accept.py`](gateway/src/gateway/accept.py), [`validation.py`](gateway/src/gateway/validation.py) | `test_send_api.py` |
| Tenant isolation (404 for another tenant's message) | [`api/tenant.py`](gateway/src/gateway/api/tenant.py), [`queries.py`](gateway/src/gateway/queries.py) | `test_isolation.py` |
| Idempotency | [`accept.py`](gateway/src/gateway/accept.py) | `test_idempotency.py` |
| Encoding, segments, price | [`encoding.py`](gateway/src/gateway/encoding.py), [`pricing.py`](gateway/src/gateway/pricing.py) | `test_encoding.py` |
| Prepaid billing, ledger, refunds | [`billing.py`](gateway/src/gateway/billing.py), [`lifecycle.py`](gateway/src/gateway/lifecycle.py) | `test_billing.py` |
| Queue, fairness, leases, crash recovery | [`dispatch.py`](gateway/src/gateway/dispatch.py) | `test_dispatch.py` |
| Carrier rate limit across workers | [`limiter.py`](gateway/src/gateway/limiter.py) | `test_dispatch.py` |
| Retry rules | [`retry.py`](gateway/src/gateway/retry.py), [`carrier.py`](gateway/src/gateway/carrier.py) | `test_dispatch.py` |
| DLRs: signature, early, duplicate, forward-only status | [`dlr.py`](gateway/src/gateway/dlr.py), [`messages.py`](gateway/src/gateway/messages.py) | `test_dlr.py` |
| Tenant webhooks with backoff, isolated | [`webhooks.py`](gateway/src/gateway/webhooks.py) | `test_webhooks.py` |
| Dashboard | [`dashboard/`](dashboard) | `npm run test` |
| Mock carrier | [`mock-carrier/`](mock-carrier) | `mock-carrier/tests` |
| Load script | [`loadtest/load_test.py`](loadtest/load_test.py) | output below |
| Migrations and seed | [`migrations/`](gateway/migrations), [`migrate.py`](gateway/src/gateway/migrate.py), [`seed.py`](gateway/src/gateway/seed.py) | run by `docker compose up` |

Bonus items that are in: HMAC signature on tenant webhooks, Prometheus metrics
(`/metrics`: queue depth, submit outcomes, DLR delay), and an optional
de-duplicating mode in the mock carrier that makes the timeout risk measurable.

## Load test

```
docker compose run --rm loadtest
```

10,000 ShopFast messages in ten batches and, at the same time, one Acme Bank OTP
per second, against two dispatcher processes. The script uses only the public
API (plus the mock carrier's `/stats`) and checks the money itself from the
ledger. Output of one real run:

<!-- LOAD_OUTPUT_START -->
This run: Windows 11, PostgreSQL 16, two dispatcher processes, every service as a local process (not in Docker), with a Python Redis stand-in in place of Valkey.

```text
SMS gateway load test
=====================
  Run id         b5a23c9e
  Started (UTC)  2026-11-24T15:53:54Z
  Gateway        http://127.0.0.1:8000
  Carrier        http://127.0.0.1:9000
  Campaign       10000 ShopFast messages, 1000 per batch
  OTP            one Acme Bank message every 1 s
  Deadline       900 s

Progress (campaign status counts for this run)
----------------------------------------------
   elapsed  ACCEPTED  QUEUED  SUBMITTED  DELIVERED  UNDELIVERED  EXPIRED  FAILED  OTPs sent
      5.0s         0    9801        154         37            5        0       3          5
     35.1s         0    8494        207       1158          100       30      11         36
     65.2s         0    7199        190       2332          186       71      22         66
     95.3s         0    5910        209       3463          278      110      30         96
    125.5s         0    4605        219       4622          361      150      43        126
    155.6s         0    3302        214       5786          453      189      56        156
    185.6s         0    2004        196       6962          540      233      65        186
    215.8s         0     705        204       8087          649      273      82        216
    245.8s         0       0          0       8904          711      293      92        242

Timing
------
  Campaign accepted by the gateway  0.9 s (10000 messages)
  All campaign messages final       241.7 s
  All messages final (total time)   247.8 s (242 OTPs sent meanwhile)

Submit rate to the carrier
--------------------------
  Gateway view (GET /v1/messages, this run's messages)
    Submit attempts     10673
    Messages submitted  10147
    First submitted_at  2026-11-24T15:53:55.315241Z
    Last submitted_at   2026-11-24T15:57:56.365797Z
    Window              241.1 s
    Average rate        44.3 per second
  Carrier view (GET /stats, since the reset before this run)
    received                   10673
    accepted                   10265
    rate_limited (429)         0
    max_submits_in_one_second  48 (stayed within the limit of 50)
    timeouts                   118
    duplicate_accepts          118
    Average rate               44.3 per second

OTP latency, accept to SUBMITTED
--------------------------------
  OTPs accepted                       242
  Never reached SUBMITTED (excluded)  3
  n                                   239
  p50                                 224 ms
  p95                                 451 ms
  max                                 2570 ms

Final states (this run)
-----------------------
  Status          shopfast  acme-bank  Total
  DELIVERED           8904        211   9115
  UNDELIVERED          711         19    730
  EXPIRED              293          9    302
  FAILED                92          3     95
  Total              10000        242  10242
  Accepted (202)     10000        242  10242

Billing check
-------------
  shopfast
    Opening balance                     1000.000000 USD
    Balance before this run              960.512000 USD
    Balance now                          920.880000 USD
    Ledger entries read                       20220
    Gateway's own 'consistent' flag            true
    PASS  balance = opening balance - ledger sum           (920.880000 = 1000.000000 - 79.120000)
    PASS  no message charged twice                         (message ids with more than one CHARGE: 0)
    PASS  no message refunded twice                        (message ids with more than one REFUND: 0)
    PASS  run: each message charged once, at its cost      (0 of 10000 differ)
    PASS  run: each FAILED message refunded once, in full  (0 of 92 differ)
    PASS  run: no refund on a message that is not FAILED   (0 found)
    PASS  balance never negative                           (lowest seen 920.512000)
  acme-bank
    Opening balance                      250.000000 USD
    Balance before this run              244.960000 USD
    Balance now                          239.941000 USD
    Ledger entries read                         489
    Gateway's own 'consistent' flag            true
    PASS  balance = opening balance - ledger sum           (239.941000 = 250.000000 - 10.059000)
    PASS  no message charged twice                         (message ids with more than one CHARGE: 0)
    PASS  no message refunded twice                        (message ids with more than one REFUND: 0)
    PASS  run: each message charged once, at its cost      (0 of 242 differ)
    PASS  run: each FAILED message refunded once, in full  (0 of 3 differ)
    PASS  run: no refund on a message that is not FAILED   (0 found)
    PASS  balance never negative                           (lowest seen 239.941000)

Result: PASS
```

Progress lines are thinned to one per 30 seconds here; the complete output is in
[docs/load-test-run.txt](docs/load-test-run.txt).
<!-- LOAD_OUTPUT_END -->

## Tests

```
docker compose run --rm tests        # gateway: 112 tests against real PostgreSQL and Valkey
```

Without Docker, with a PostgreSQL database whose name ends in `_test`:

```
cd gateway
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/smsgw_test uv run pytest
cd ../mock-carrier && uv run pytest
cd ../dashboard && npm ci && npm run test
```

The gateway tests run against a real database on purpose. What they check (row
locks, `SKIP LOCKED`, unique indexes, `CHECK` constraints) does not exist in a
mock. The seven areas the brief asks for:

| Asked for | Test |
|---|---|
| Encoding and segments, GSM-7 extension, UCS-2 | `test_encoding.py` (Bangla, emoji, escape pair at a segment boundary) |
| Same request twice: one message, one charge | `test_same_key_same_body_creates_one_message_and_one_charge`, and 20 at once |
| DLR before the submit response, duplicate DLR | `test_dlr_that_arrives_before_the_submit_response_is_not_lost`, `test_duplicate_dlr_has_no_effect` |
| Concurrent sends over the balance | `test_concurrent_sends_cannot_overspend` (60 requests, money for 10) |
| 429 and 503 retried, 400 not | `test_503_and_429_are_retried_until_accepted`, `test_400_is_never_retried` |
| DLR with a missing or wrong signature | `test_dlr_without_a_valid_signature_changes_nothing` |
| One tenant cannot read another's message | `test_a_tenant_cannot_read_another_tenants_message` |

## Dashboard

Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, TanStack Query. The
browser never holds the admin token: the Next.js server proxies `/api/gateway/*`
to the gateway and passes the Server-Sent Events stream through.

| | |
|---|---|
| ![Messages](docs/screenshots/messages.png) | ![Message detail](docs/screenshots/detail.png) |
| Filters live in the URL. Rows update in place as statuses change. | The full history: status events, submit attempts, DLRs, ledger, webhook. |
| ![Send test message](docs/screenshots/send.png) | ![Overview, dark](docs/screenshots/overview-dark.png) |
| Encoding, segments and price as you type, with the characters that forced UCS-2. | Per-tenant balance and counts, the pipeline, submits per second against the carrier limit. |

## Layout

```
gateway/          FastAPI app, dispatcher, webhook worker, migrations, tests
  src/gateway/
    accept.py       validate, price, charge, enqueue: one transaction
    dispatch.py     claim (fair, SKIP LOCKED, lease), submit, record
    limiter.py      GCRA rate limit in Valkey
    retry.py        the retry policy, as one table
    dlr.py          delivery receipts: signature, de-duplication, early arrival
    messages.py     transition(): the only place a status changes
    billing.py      charge, refund, balance report
    webhooks.py     tenant callbacks from an outbox
mock-carrier/     the carrier stand-in and the webhook sink
dashboard/        Next.js internal console
loadtest/         the load script
shared/           encoding vectors used by the Python and TypeScript tests
docs/             API reference, screenshots
```

## Assumptions and trade-offs

- **A timeout is retried, so a duplicate SMS is possible.** The brief requires the
  retry; the gateway sends the same `message_id` each time and flags every message
  that had an attempt with an unknown outcome. `IDEMPOTENT_SUBMIT=true docker
  compose up` shows the same run with a carrier that de-duplicates. See
  [DESIGN.md](DESIGN.md), question 1.
- **PostgreSQL is the queue.** Accept, charge and enqueue are one transaction.
  Valkey holds only the rate limit and the live-update channel.
- **A batch is all-or-nothing**, including its charge. One invalid number rejects
  all 1,000. Simple and safe for money; a per-message result would be friendlier
  for large campaigns.
- **Money is integer micros** everywhere (1 USD = 1,000,000). There is not one
  float in a price. A message keeps the price it was accepted at; the price table
  is cached for 30 seconds per API process.
- **"70 / 67 characters" for UCS-2 means UTF-16 code units**, so an emoji counts
  as two, and a two-unit character (an emoji, or a GSM-7 escape pair such as `{`)
  is never split across two segments.
- **The gateway aims at 46 submits per second, not 50**, and never sends more
  than two back to back. The worst second the carrier can see is then 48. The
  margin is for clock and network jitter between us and the carrier's window.
- **Every attempt counts toward the limit of 6**, whatever the cause, 429 included.
- **A refund follows a final failure even after an ambiguous attempt.** The
  carrier may have delivered that message; we cannot prove it, so we do not
  charge for it.
- **A status event's time is our clock**, when we recorded the change. The
  carrier's own timestamp is kept in the event detail.
- **API keys are stored as SHA-256.** Only the first eight characters are kept in
  clear, for display.

## Not done, and what I would do with more time

- No top-up endpoint and no API key rotation: balances come from the seed.
- Fairness is equal shares per tenant. Weights and a traffic class per message
  (transactional before bulk) are the next step.
- No second carrier, routing or failover; no scheduled messages; no templates.
- Callback URLs are not checked against private address ranges (SSRF).
- A message whose DLR never arrives stays `SUBMITTED`. A sweeper that expires
  it after the carrier's validity period is missing.
- Idempotency keys and finished webhook rows are never purged.
- The dashboard has no login; it relies on the proxy holding the admin token.
- Metrics are per process (two API workers report separately); there is no
  Grafana board.

## AI tools

This project was built with Claude Code. Commits it wrote carry a
`Co-Authored-By: Claude` trailer. The session transcript belongs in
[docs/ai-transcript](docs/ai-transcript).
