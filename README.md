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

No Docker at hand? The same stack runs in a GitHub Codespace. It builds and
starts by itself (about three minutes the first time) and opens the dashboard:

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/MicoleKurt/mini-sms-gateway?quickstart=1)

In a codespace the load test runs from its terminal: `docker compose run --rm loadtest`.

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
    SUBMITTED --> EXPIRED: DLR EXPIRED, or no DLR in 24 h
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
| DLRs: signature, early, duplicate, forward-only status, lost | [`dlr.py`](gateway/src/gateway/dlr.py), [`messages.py`](gateway/src/gateway/messages.py), [`sweeper.py`](gateway/src/gateway/sweeper.py) | `test_dlr.py` |
| Tenant webhooks with backoff, isolated | [`webhooks.py`](gateway/src/gateway/webhooks.py) | `test_webhooks.py` |
| Dashboard | [`dashboard/`](dashboard) | `npm run test` |
| Mock carrier | [`mock-carrier/`](mock-carrier) | `mock-carrier/tests` |
| Load script | [`loadtest/load_test.py`](loadtest/load_test.py) | output below |
| Migrations and seed | [`migrations/`](gateway/migrations), [`migrate.py`](gateway/src/gateway/migrate.py), [`seed.py`](gateway/src/gateway/seed.py) | run by `docker compose up` |

Bonus items that are in: HMAC signature on tenant webhooks (the tenant reads
its secret from `GET /v1/webhook`), Prometheus metrics, and an optional
de-duplicating mode in the mock carrier that makes the timeout risk measurable.

Metrics are per process, so each process serves its own:

| Where | What |
|---|---|
| API, `GET /metrics` on port 8000 (no credentials, so no tenant labels) | messages accepted; queue depth and submits in flight, read at scrape time; DLRs received by result; DLR delay and final statuses for DLRs the API applied |
| Dispatchers and the webhook worker, port 9464 inside the compose network (not published on the host) | dispatcher: submit outcomes and durations, final statuses it set, acceptances recorded after a message had failed; webhook worker: callback results, messages expired without a DLR. The queue gauges are only on the API: a worker does not refresh them |

## Load test

```
docker compose run --rm loadtest
```

10,000 ShopFast messages in ten batches and, at the same time, one Acme Bank OTP
per second, against two dispatcher processes. The script uses only the public
API (plus the mock carrier's `/stats`) and checks the money itself from the
ledger. Output of one real run:

<!-- LOAD_OUTPUT_START -->
This run: `docker compose up` on a GitHub Actions Linux runner (the `e2e` job in [ci.yml](.github/workflows/ci.yml)), two dispatcher containers, PostgreSQL 17, Valkey 8.

```text
SMS gateway load test
=====================
  Run id         e6260953
  Started (UTC)  2026-11-24T17:14:43Z
  Gateway        http://gateway:8000
  Carrier        http://mock-carrier:9000
  Campaign       10000 ShopFast messages, 1000 per batch
  OTP            one Acme Bank message every 1 s
  Deadline       900 s

Progress (campaign status counts for this run)
----------------------------------------------
   elapsed  ACCEPTED  QUEUED  SUBMITTED  DELIVERED  UNDELIVERED  EXPIRED  FAILED  OTPs sent
      5.0s         0    9804        142         48            3        1       2          5
     35.1s         0    8501        210       1149           89       38      13         36
     65.2s         0    7195        212       2291          196       76      30         66
     95.3s         0    5894        206       3459          274      124      43         96
    125.4s         0    4594        200       4625          358      166      57        126
    155.4s         0    3302        199       5779          457      200      63        156
    185.5s         0    2011        200       6932          543      240      74        186
    215.5s         0     711        213       8069          641      282      84        216
    245.8s         0       0          0       8884          712      310      94        242

Timing
------
  Campaign accepted by the gateway  2.4 s (10000 messages)
  All campaign messages final       241.7 s
  All messages final (total time)   249.8 s (242 OTPs sent meanwhile)

Submit rate to the carrier
--------------------------
  Gateway view (GET /v1/messages, this run's messages)
    Submit attempts     10659
    Messages submitted  10146
    First submitted_at  2026-11-24T17:14:43.695293Z
    Last submitted_at   2026-11-24T17:18:44.639829Z
    Window              240.9 s
    Average rate        44.2 per second
  Carrier view (GET /stats, since the reset before this run)
    received                   10659
    accepted                   10259
    rate_limited (429)         0
    max_submits_in_one_second  48 (stayed within the limit of 50)
    timeouts                   113
    duplicate_accepts          110
    Average rate               44.2 per second

OTP latency, accept to SUBMITTED
--------------------------------
  OTPs accepted                       242
  Never reached SUBMITTED (excluded)  2
  n                                   240
  p50                                 260 ms
  p95                                 839 ms
  max                                 2718 ms

Final states (this run)
-----------------------
  Status          shopfast  acme-bank  Total
  DELIVERED           8884        223   9107
  UNDELIVERED          712         11    723
  EXPIRED              310          6    316
  FAILED                94          2     96
  Total              10000        242  10242
  Accepted (202)     10000        242  10242

Billing check
-------------
  shopfast
    Opening balance                     1000.000000 USD
    Balance before this run             1000.000000 USD
    Balance now                          960.376000 USD
    Ledger entries read                       10094
    Gateway's own 'consistent' flag            true
    PASS  balance = opening balance - ledger sum           (960.376000 = 1000.000000 - 39.624000)
    PASS  no message charged twice                         (message ids with more than one CHARGE: 0)
    PASS  no message refunded twice                        (message ids with more than one REFUND: 0)
    PASS  run: each message charged once, at its cost      (0 of 10000 differ)
    PASS  run: each FAILED message refunded once, in full  (0 of 94 differ)
    PASS  run: no refund on a message that is not FAILED   (0 found)
    PASS  balance never negative                           (lowest seen 960.004000)
  acme-bank
    Opening balance                      250.000000 USD
    Balance before this run              250.000000 USD
    Balance now                          244.960000 USD
    Ledger entries read                         244
    Gateway's own 'consistent' flag            true
    PASS  balance = opening balance - ledger sum           (244.960000 = 250.000000 - 5.040000)
    PASS  no message charged twice                         (message ids with more than one CHARGE: 0)
    PASS  no message refunded twice                        (message ids with more than one REFUND: 0)
    PASS  run: each message charged once, at its cost      (0 of 242 differ)
    PASS  run: each FAILED message refunded once, in full  (0 of 2 differ)
    PASS  run: no refund on a message that is not FAILED   (0 found)
    PASS  balance never negative                           (lowest seen 244.960000)

Result: PASS
```

Progress lines are thinned to one per 30 seconds here; the complete output is in
[docs/load-test-run.txt](docs/load-test-run.txt).
<!-- LOAD_OUTPUT_END -->

How to read it:

- **Carrier limit.** No submit was answered 429, and the carrier's worst second
  saw 48 submits. The gateway paces at 46 per second with a burst of two, so 48
  is the most it can send in any one-second window.
- **OTP during the campaign.** Half of the OTPs were `SUBMITTED` within 260 ms of
  being accepted, and that includes the carrier's own response time of 20 to
  300 ms. The slow tail is OTPs whose first submit got a 503 or a timeout and
  were retried.
- **`duplicate_accepts: 110`.** The carrier accepted 110 messages twice, one for
  almost every submit it timed out on after accepting. This is the risk the
  brief asks about, measured from the carrier's side. Each of those messages is
  flagged in the database. With `IDEMPOTENT_SUBMIT=true` the number is 0.
- **Money.** Every check is computed by the script from the ledger it read
  through the public API.

## Tests

```
docker compose run --rm tests        # gateway: 174 tests against real PostgreSQL and Valkey
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

The first version worked but looked like every default dashboard: cards inside
cards, tinted pills, five equal tiles. I mocked up three art directions, had
them judged from screenshots, and rebuilt the UI in the one that won. It reads
like a printed statement: a paper ground, hairline rules instead of boxes, IBM
Plex Sans for words and Plex Mono for every figure, and one sentence at the top
of each screen that says what is going on. Colour is a small set of inks and
each one means something: viridian for delivered, ultramarine for submitted,
ochre for queued, plum for the carrier's failures, vermilion for ours and for
anything that needs a person. A script checks every text colour for contrast in
both themes (`npm run check:contrast`).

| | |
|---|---|
| ![Messages](docs/screenshots/messages.png) | ![Message detail](docs/screenshots/detail.png) |
| Filters live in the URL. Rows update in place; failures are the rows in colour. | One sentence for the outcome, where the time went on a seconds axis, then the full history: status events, attempts, receipt, ledger, webhook. |
| ![Send test message](docs/screenshots/send.png) | ![Overview, dark](docs/screenshots/overview-dark.png) |
| Encoding, segments and price on every keystroke. The character that forced UCS-2 is boxed in the text and named, with what the message would cost without it. | The same overview in the dark theme, during a campaign. |

## Layout

```
gateway/          FastAPI app, dispatcher, webhook worker, migrations, tests
  src/gateway/
    accept.py       validate, price, charge, enqueue: one transaction
    dispatch.py     claim (fair, SKIP LOCKED, lease), submit, record
    limiter.py      GCRA rate limit in Valkey
    retry.py        the retry policy, as one table
    dlr.py          delivery receipts: signature, de-duplication, early arrival
    sweeper.py      expires messages whose DLR never came
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
  charge for it. If a worker that outlived its lease later records that the
  carrier did accept it, the message stays `FAILED` and refunded; the case is
  logged as an error and counted in `smsgw_accepted_after_failed_total`.
- **A DLR that never comes ends in `EXPIRED`.** A message still `SUBMITTED`
  24 hours after its submit (`DLR_WAIT_SECONDS`, the carrier's validity period)
  is moved to `EXPIRED` with reason `NO_DLR` by a sweep in the webhook process.
  The charge is kept, because the carrier accepted the message. A DLR that
  arrives later is stored and ignored.
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
- Idempotency keys and finished webhook rows are never purged.
- The dashboard has no login; it relies on the proxy holding the admin token.
- Metrics are per process (two API workers report separately); there is no
  Grafana board.

## AI tools

This project was built with Claude Code. Commits it wrote carry a
`Co-Authored-By: Claude` trailer. The session transcript belongs in
[docs/ai-transcript](docs/ai-transcript).
