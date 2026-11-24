# Load test

`load_test.py` sends 10,000 ShopFast campaign messages and, at the same time, one
Acme Bank OTP every second. When every message of the run has reached a final
state it prints a report: total time and submit rate, OTP latency, final state
counts and a billing check.

It talks only to public HTTP APIs: the gateway tenant API (`docs/API.md`,
"Tenant API") with the two seeded API keys, and optionally the mock carrier's
`GET /stats` and `POST /reset`. It has no database access, so every number in the
report is something a tenant could have measured.

## Run it

With the stack running (gateway on 8000, mock carrier on 9000), from the repo root:

```
uv run loadtest/load_test.py
```

`uv` reads the dependency (`httpx`) from the script header, so there is nothing to
install. Python 3.11 or newer is required.

Inside Docker, where the gateway image already has `httpx`:

```
docker compose run --rm loadtest
```

The compose service sets `GATEWAY_URL` and `CARRIER_URL` to the service names. To
pass flags, give the whole command:

```
docker compose run --rm loadtest python /app/loadtest/load_test.py --messages 2000
```

A smaller run for a quick look:

```
uv run loadtest/load_test.py --messages 500 --batch-size 100 --otp-interval 0.5
```

## Flags

| Flag             | Default                 | Meaning                                                              |
|------------------|-------------------------|----------------------------------------------------------------------|
| `--gateway-url`  | `http://localhost:8000` | Gateway base URL. Falls back to the env var `GATEWAY_URL`.           |
| `--carrier-url`  | `http://localhost:9000` | Mock carrier base URL. Falls back to `CARRIER_URL`. `""` turns the carrier section off. |
| `--shopfast-key` | seeded dev key          | API key for the campaign tenant.                                     |
| `--acme-key`     | seeded dev key          | API key for the OTP tenant.                                          |
| `--messages`     | `10000`                 | Campaign messages to send.                                           |
| `--batch-size`   | `1000`                  | Messages per `POST /v1/messages/batch` (1 to 1000).                  |
| `--otp-interval` | `1.0`                   | Seconds between OTPs.                                                |
| `--timeout`      | `900`                   | Seconds allowed for sending and for every message to become final.  |
| `--run-id`       | 8 random hex characters | Marks this run's messages. See below.                                |

Exit code: `0` when the billing check passes, `1` when a billing check fails, `2`
when the run could not finish (timeout, an API error that is not retried, bad
arguments).

## What the script does

1. Reads `GET /v1/balance` and `GET /v1/messages/stats` for both tenants. This is
   the baseline: the gateway's counters cover all time, so "this run" is always
   "now minus baseline".
2. Calls `POST /reset` on the carrier so its counters start at zero. If that
   fails the run continues and the carrier section says so.
3. Sends the campaign as batches, one after another, without a pause. The
   gateway queues them; pacing towards the carrier is the gateway's job, not the
   script's.
4. From the same moment sends one OTP per interval on a fixed schedule: OTP `n`
   is due at `start + n * interval`, and each send is its own task, so a slow
   response does not delay the next one. OTPs keep going until every campaign
   message is final. Then the sender stops and the script waits for the
   remaining OTPs.
5. Reads the results back and prints the report.

Each message carries a `client_ref` of `load-<run>-c-<n>` (campaign) or
`load-<run>-otp-<n>` (OTP). The report selects this run's messages by that prefix,
so the tenants' older messages do not leak into it.

Every POST carries an `Idempotency-Key` (`<run>-batch-<i>`, `<run>-otp-<n>`). On a
network error or a 5xx the script repeats the same request with the same key, up
to 5 times with a growing pause. If the first try did reach the gateway, the
gateway answers with the stored response and nothing is accepted or charged a
second time. Any 4xx stops the run and prints the error body.

Campaign destinations are distinct Bangladesh numbers (`+88017` plus 8 digits);
OTP destinations are United Arab Emirates numbers (`+97150` plus 7 digits). The
digits come from the run id and the message index, so two runs do not reuse the
same range.

## Reading the report

The snippets below show the layout. Their numbers are illustrative; they are not
a measurement of the gateway.

### Header and progress

```
SMS gateway load test
=====================
  Run id         3f9c1d7e
  Started (UTC)  2026-11-24T15:04:05Z
  ...

Progress (campaign status counts for this run)
----------------------------------------------
   elapsed  ACCEPTED  QUEUED  SUBMITTED  DELIVERED  UNDELIVERED  EXPIRED  FAILED  OTPs sent
      5.0s         0    9764        188         41            4        2       1          5
```

One line every 5 seconds: the ShopFast status counts from
`GET /v1/messages/stats` minus the baseline, and how many OTPs have been accepted
so far. A line that starts with `! retry` means a request was repeated with the
same idempotency key.

### Timing

- **Campaign accepted by the gateway**: time until the last batch got its `202`.
  This is how long the tenant waits, and it should be seconds.
- **All campaign messages final**: time until all campaign messages are
  `DELIVERED`, `UNDELIVERED`, `EXPIRED` or `FAILED`.
- **All messages final (total time)**: the same, including the last OTPs. This is
  the total time of the run.

Durations use a monotonic clock, starting at the first request of the load phase.

### Submit rate to the carrier

**Gateway view.** Built from `GET /v1/messages` for this run's messages of both
tenants: the sum of `attempts` (every submit the gateway started, including the
ones that got a `429`, a `503` or no answer) and the first and last
`submitted_at`. The average rate is `attempts / (last - first)`. It is slightly
approximate, because `submitted_at` is the time of the accepted attempt and the
tenant API has no timestamp for the attempts that were not accepted.

**Carrier view.** The carrier's own counters from `GET /stats`, which is the direct
measurement:

- `received`, `accepted`: submits seen and submits accepted.
- `rate_limited (429)`: submits refused for exceeding the limit. Zero means the
  gateway's pacing never overshot.
- `max_submits_in_one_second`: the largest number of submits the carrier
  admitted in any one second. It cannot be above the carrier's own limit, so
  the line says "stayed within the limit of 50" only when this peak is at most
  50 and `rate_limited` is 0.
- `timeouts`: submits the carrier accepted without answering.
- `duplicate_accepts`: accepted submits for a message that had already been
  accepted, which is an SMS that would reach a handset twice.
- `Average rate`: `received` divided by the time between the carrier's first and
  last submit.

The carrier counts everything since the reset, so other traffic during the run
is included.

### OTP latency, accept to SUBMITTED

For every OTP the script reads `GET /v1/messages/{id}` and takes the time between
the `ACCEPTED` event and the `SUBMITTED` event. This is the time an OTP spent in
the gateway before the carrier took it, and it shows whether the campaign backlog
delayed the other tenant. `p50` and `p95` use the nearest-rank method: the value
at position `ceil(p / 100 * n)` of the sorted list, with no interpolation. OTPs
that never reached `SUBMITTED` (the carrier rejected them) are counted on their own
line and left out.

### Final states (this run)

Messages of this run per final status, per tenant and in total. `Total` is what
the API lists for this run and `Accepted (202)` is what the script was told when
it sent; the two rows must be equal. A warning is printed if they are not, or if
a message is listed in a status that is not final.

### Billing check

Per tenant, computed by the script from `GET /v1/ledger` (every page) and
`GET /v1/balance`. The gateway's own `consistent` flag is printed but not used.

| Check | What it proves |
|-------|----------------|
| `balance = opening balance - ledger sum` | The balance is exactly explained by the ledger. Whole ledger. |
| `no message charged twice` | No `message_id` has more than one `CHARGE`. Whole ledger. |
| `no message refunded twice` | No `message_id` has more than one `REFUND`. Whole ledger. |
| `run: each message charged once, at its cost` | Every message of this run has one `CHARGE` equal to its `cost_micros`. |
| `run: each FAILED message refunded once, in full` | Every `FAILED` message has one `REFUND` equal to minus its `CHARGE`. |
| `run: no refund on a message that is not FAILED` | Delivered, undelivered and expired messages stay charged. |
| `balance never negative` | The balance now and every `balance_after_micros` in the ledger are `>= 0`. |

The last line is `Result: PASS` or `Result: FAIL (billing check)`.

## Assumptions

- The two tenants are idle when the run starts and nothing else sends for them
  during it. Completion is detected from the per-tenant counters, which cannot
  tell one run from another. The script warns if it finds messages in flight at
  the start.
- The clocks of this machine and the gateway agree to within 60 seconds. The
  message list is fetched with `created_from` set to the start of the run minus
  that allowance.
- The balance is enough: a full run costs about 40 USD for ShopFast and 0.021 USD
  per OTP for Acme Bank. A `402` stops the run.
