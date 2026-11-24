# mock-carrier

Two small test tools for the SMS gateway, in one Python package:

- **Mock carrier** (`mock_carrier.carrier`, port 9000): stands in for a mobile operator.
  It accepts submits, misbehaves on purpose (rate limit, 503, 400, timeouts) and sends
  signed delivery receipts (DLRs) back to the gateway, some of them twice and some
  before the submit response.
- **Webhook sink** (`mock_carrier.sink`, port 9100): stands in for the tenants'
  callback endpoints. It records calls and can be made slow or broken per tenant.

Both keep everything in memory and run as a single process each. The contract is
[`docs/API.md`](../docs/API.md).

## Run

```sh
uv sync
uv run uvicorn mock_carrier.carrier:app --port 9000
uv run uvicorn mock_carrier.sink:app --port 9100
```

Run one worker per app. Counters and the rate-limit window live in the process, so a
second worker would have its own.

## Check

```sh
uv run pytest -q
uv run ruff check .
```

## Mock carrier

| Route          | Purpose                                                        |
|----------------|----------------------------------------------------------------|
| `POST /submit` | Submit one message. Responses are listed in `docs/API.md`      |
| `GET /stats`   | Counters since start or since the last reset                   |
| `POST /reset`  | Clear the counters and the memory of accepted message IDs      |
| `GET /healthz` | `{ "status": "ok" }`                                            |

What happens to a submit, in order:

1. A body with a missing field is `400 { "error": "INVALID_REQUEST" }`. It is not counted anywhere.
2. Rate limit. If `RATE_LIMIT_PER_SEC` submits were admitted in the last 1000 ms the
   answer is an immediate `429`. A `429` is not remembered, so it does not extend the window.
3. With `IDEMPOTENT_SUBMIT=true`, a `message_id` that was accepted before gets its
   first `carrier_id` again with `200`. Nothing new is created.
4. One random draw picks `503`, `400`, timeout or accept.
5. An accepted submit gets a `carrier_id` and a DLR. A timeout is an accepted submit
   whose answer is a `504` after `TIMEOUT_SECONDS`.
6. For `P_DLR_EARLY` of the submits answered `200`, the DLR is sent first and the `200`
   is written only after the gateway has answered the DLR. Timeouts are never early:
   their DLR follows the normal delay range.

Every DLR is `POST {GATEWAY_URL}/carrier/dlr` with `X-Signature`, the hex HMAC-SHA256
of the exact body bytes with `DLR_SECRET`. A duplicate DLR is the same bytes sent again
50 to 500 ms later. If the gateway is unreachable or answers `5xx`, the DLR is retried
up to 3 times (after 0.2 s, 0.5 s and 1 s). A `4xx` is not retried.

### Environment

| Variable                               | Default               | Meaning                                              |
|----------------------------------------|-----------------------|------------------------------------------------------|
| `GATEWAY_URL`                          | `http://gateway:8000` | DLRs go to `{GATEWAY_URL}/carrier/dlr`               |
| `DLR_SECRET`                           | `dev-dlr-secret`      | HMAC key for `X-Signature`                           |
| `MIN_LATENCY_MS`, `MAX_LATENCY_MS`     | `20`, `300`           | Response time range                                  |
| `RATE_LIMIT_PER_SEC`                   | `50`                  | Admitted submits per sliding second before `429`     |
| `P_TEMPORARY_FAILURE`                  | `0.03`                | Share of `503`                                       |
| `P_PERMANENT_FAILURE`                  | `0.01`                | Share of `400`                                       |
| `P_TIMEOUT`                            | `0.01`                | Share of accepted-but-silent submits                 |
| `TIMEOUT_SECONDS`                      | `5`                   | How long a timeout hangs before the `504`            |
| `DLR_MIN_DELAY_MS`, `DLR_MAX_DELAY_MS` | `500`, `10000`        | Delay between acceptance and the DLR                 |
| `P_DELIVRD`, `P_UNDELIV`, `P_EXPIRED`  | `0.90`, `0.07`, `0.03`| DLR status mix. Used as weights                      |
| `P_DLR_DUPLICATE`                      | `0.10`                | Share of DLRs sent twice                             |
| `P_DLR_EARLY`                          | `0.05`                | Share of DLRs answered before the submit response    |
| `IDEMPOTENT_SUBMIT`                    | `false`               | Repeated `message_id` returns the first `carrier_id` |
| `RANDOM_SEED`                          | unset                 | Integer seed for a repeatable run                    |

The three submit shares are of admitted submits and must add up to at most 1. A value
that cannot be parsed or is out of range stops the app at start with the variable name
in the error.

### Notes on the counters

- `received` counts every well-formed submit, including the ones answered `429`.
- `accepted` includes timeouts. `accepted = unique_message_ids_accepted + duplicate_accepts`.
- `dlrs_sent` counts DLR requests the gateway answered with `2xx`, duplicates included.
  `dlrs_failed` counts DLR requests that were given up: a `4xx`, or still no `2xx` after the retries.
- With `IDEMPOTENT_SUBMIT=true` a replayed submit is counted in `received` only. It is
  not a new accept, so it is not a duplicate accept either.
- `RANDOM_SEED` fixes the outcomes, latencies, DLR statuses and delays for submits that
  arrive in the same order. Carrier IDs are always fresh random values, because the
  gateway stores them and a restarted carrier must not reuse one.
- `POST /reset` does not cancel DLRs that are already scheduled. They are still sent
  and are counted after the reset.

## Webhook sink

| Route                       | Purpose                                              |
|-----------------------------|------------------------------------------------------|
| `POST /hooks/{tenant_slug}` | Record the call, answer `200 { "status": "ok" }`     |
| `GET /stats`                | Counts per tenant                                    |
| `GET /healthz`              | `{ "status": "ok" }`                                 |

The sink verifies nothing: not the signature, not the body.

```json
{ "tenants": { "acme-bank": { "received": 12, "failed": 2, "last_received_at": "2026-11-24T15:04:05.123456Z" } } }
```

`failed` is the number of calls the sink answered with `500 { "error": "SINK_FAILURE" }`.

### Environment

`<SLUG>` is the tenant slug in upper case with `-` replaced by `_` (`acme-bank` becomes `ACME_BANK`).

| Variable               | Example    | Meaning                                         |
|------------------------|------------|-------------------------------------------------|
| `SINK_FAIL_<SLUG>`     | `0.2`      | Share of calls answered `500` for that tenant   |
| `SINK_DELAY_MS_<SLUG>` | `200-1500` | Response delay range in milliseconds, `min-max` |

A tenant with no variables is answered `200` at once.
