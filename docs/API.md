# API reference

All services speak JSON over HTTP. This file is the contract between the gateway,
the mock carrier, the dashboard and the load script.

| Service        | Port | Purpose                                             |
|----------------|------|-----------------------------------------------------|
| `gateway`      | 8000 | Tenant API, carrier DLR endpoint, internal API, SSE |
| `mock-carrier` | 9000 | Stand-in for a mobile operator                      |
| `webhook-sink` | 9100 | Stand-in for the tenants' callback endpoints        |
| `dashboard`    | 3000 | Internal dashboard (Next.js)                        |

## Conventions

- **Money** is always an integer number of **micros** (1 USD = 1,000,000 micros) in
  fields that end in `_micros`. There are no floats in the API.
- **Time** is ISO 8601 in UTC, for example `2026-11-24T15:04:05.123456Z`.
- **IDs** are UUIDs. Message IDs are UUIDv7, so they sort by creation time.
- **Errors** always have this shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed.",
             "details": [ { "field": "to", "code": "INVALID_E164", "message": "..." } ] } }
```

`details` is present only when there is something to list. In a batch, each detail
also has `index` (the position of the message in the request).

| HTTP | `code`                         | Meaning                                                    |
|------|--------------------------------|------------------------------------------------------------|
| 401  | `UNAUTHORIZED`                 | Missing or unknown `X-API-Key` / `X-Admin-Token`           |
| 401  | `INVALID_SIGNATURE`            | DLR without a valid `X-Signature`                          |
| 402  | `INSUFFICIENT_BALANCE`         | The charge is larger than the balance. Nothing was created |
| 404  | `NOT_FOUND`                    | No such resource **for this tenant**                       |
| 409  | `IDEMPOTENCY_KEY_REUSED`       | Same `Idempotency-Key`, different request                  |
| 422  | `VALIDATION_ERROR`             | Bad input. See `details`                                   |
| 500  | `INTERNAL_ERROR`               | Unexpected server error. It is logged; no detail is returned |

Validation detail codes: `REQUIRED`, `INVALID_E164`, `UNSUPPORTED_DESTINATION`
(no price for this prefix), `INVALID_SENDER_ID`, `EMPTY_TEXT`, `MESSAGE_TOO_LONG`,
`INVALID_VALUE`, `BATCH_TOO_LARGE`, `BATCH_EMPTY`.

## Tenant API

Authentication: `X-API-Key: <key>`. Every route below is scoped to the tenant that
owns the key. A message of another tenant is a `404`, never a `403`.

### `POST /v1/messages`

Headers: `X-API-Key`, optional `Idempotency-Key` (1 to 255 characters).

```json
{ "to": "+8801711000001", "from": "ACME", "text": "Your code is 482913", "client_ref": "otp-1" }
```

- `to`: E.164, `^\+[1-9]\d{6,14}$`. It is not normalised and not guessed.
- `from`: sender ID. 1 to 11 characters of `A-Z a-z 0-9` and space, or 3 to 15 digits.
- `text`: 1 character up to 10 segments.
- `client_ref`: optional, up to 64 characters.

`202 Accepted`:

```json
{
  "id": "019a3c5e-7b1a-7c3e-9f0a-2b6f1c0d4e5f",
  "status": "ACCEPTED",
  "to": "+8801711000001",
  "from": "ACME",
  "client_ref": "otp-1",
  "encoding": "GSM7",
  "segments": 1,
  "cost_micros": 4000,
  "currency": "USD",
  "created_at": "2026-11-24T15:04:05.123456Z"
}
```

Idempotency: the same key with the same request returns the stored response (same
status code, same body) and adds the header `Idempotent-Replay: true`. The same key
with a different request returns `409 IDEMPOTENCY_KEY_REUSED`. Only successful
requests are stored, so a request that failed validation or balance can be fixed
and sent again with the same key.

### `POST /v1/messages/batch`

```json
{ "messages": [ { "to": "+8801711000001", "from": "SHOPFAST", "text": "...", "client_ref": "c1" } ] }
```

1 to 1,000 messages. A batch is **atomic**: every message is accepted and charged in
one transaction, or none is. `202 Accepted`:

```json
{
  "batch_id": "019a3c5e-...",
  "count": 1,
  "total_segments": 1,
  "total_cost_micros": 4000,
  "currency": "USD",
  "created_at": "2026-11-24T15:04:05.123456Z",
  "messages": [ { "id": "019a...", "status": "ACCEPTED", "to": "+8801711000001",
                  "client_ref": "c1", "encoding": "GSM7", "segments": 1, "cost_micros": 4000 } ]
}
```

### `GET /v1/messages`

Query: `status`, `created_from`, `created_to` (ISO 8601; without an offset the
time is UTC), `client_ref` (1 to 64 characters), `batch_id`, `limit` (1 to 1000,
default 50), `cursor` (as returned in `next_cursor`). Newest first. A time that
falls outside year 1 to 9999 once converted to UTC, a value with a NUL
character, or a cursor this API did not issue is a `422`.

```json
{ "data": [ <Message> ], "next_cursor": "..." }
```

`next_cursor` is `null` on the last page.

`<Message>`:

```json
{
  "id": "019a...", "tenant_id": "…", "batch_id": null, "client_ref": "otp-1",
  "to": "+8801711000001", "from": "ACME", "text": "Your code is 482913",
  "encoding": "GSM7", "segments": 1, "cost_micros": 4000, "currency": "USD",
  "status": "DELIVERED", "attempts": 1, "ambiguous_attempts": 0,
  "carrier_id": "c-8f2a…", "failure_reason": null,
  "created_at": "…", "submitted_at": "…", "finalized_at": "…"
}
```

### `GET /v1/messages/{id}`

`<Message>` plus `"events": [ <Event> ]`, oldest first.

```json
{ "id": 4812, "status": "SUBMITTED", "occurred_at": "…", "detail": { "carrier_id": "c-8f2a…", "attempt": 1 } }
```

### `GET /v1/messages/stats`

```json
{ "total": 10000,
  "counts": { "ACCEPTED": 0, "QUEUED": 120, "SUBMITTED": 300, "DELIVERED": 8600,
              "UNDELIVERED": 650, "EXPIRED": 250, "FAILED": 80 } }
```

All seven statuses are always present.

### `GET /v1/balance`

```json
{ "tenant": "shopfast", "currency": "USD",
  "balance_micros": 960000000, "opening_balance_micros": 1000000000,
  "charged_micros": 40400000, "refunded_micros": 400000, "ledger_total_micros": 40000000,
  "consistent": true }
```

`consistent` is `balance == opening_balance - ledger_total`, computed in one snapshot.

### `GET /v1/ledger`

Query: `limit` (1 to 1000, default 100), `cursor` (as returned in
`next_cursor`; anything else is a `422`). Oldest first.

```json
{ "data": [ { "id": 1, "message_id": "019a…", "kind": "CHARGE", "amount_micros": 4000,
              "balance_after_micros": 999996000, "created_at": "…" } ],
  "next_cursor": null }
```

`amount_micros` is signed as a debit: a `CHARGE` is positive, a `REFUND` is negative.

### `GET /v1/webhook`, `PUT /v1/webhook`

`PUT` body:

```json
{ "callback_url": "https://example.com/hooks/sms" }
```

Both return:

```json
{ "callback_url": "https://example.com/hooks/sms", "signing_secret": "whsec_..." }
```

`PUT` with `null` turns the webhook off. `callback_url` must be an `http` or
`https` URL with a host, at most 2,048 characters of printable ASCII with no
whitespace (write an international domain name in its `xn--` form); anything
else is a `422`. `signing_secret` is the key for `X-Signature` below. A tenant
that has none gets one generated by its first `PUT`; after that it does not
change. When a message reaches a final state the gateway POSTs:

```json
{ "id": "<delivery uuid>", "type": "message.status",
  "message": { "id": "019a…", "client_ref": "otp-1", "to": "+8801711000001", "status": "DELIVERED",
               "segments": 1, "cost_micros": 4000, "failure_reason": null, "finalized_at": "…" } }
```

Headers: `X-Webhook-Id`, `X-Webhook-Timestamp` (unix seconds) and `X-Signature` =
hex HMAC-SHA256 of `"<timestamp>.<raw body>"` with `signing_secret`. To verify a
callback, compute that HMAC over the raw request bytes exactly as received (not
re-serialised JSON), compare it with `X-Signature` in constant time, and reject a
timestamp far from your clock to stop replays:

```python
expected = hmac.new(secret.encode(), f"{timestamp}.".encode() + raw_body, hashlib.sha256).hexdigest()
valid = hmac.compare_digest(expected, signature)
```

Any `2xx` is success. Anything else, a timeout or a connection error is a failed
attempt, retried with exponential backoff; after 6 attempts the delivery is given
up (`DEAD` in the internal API). Delivery is at-least-once; use `id` to drop repeats.

A message whose DLR never arrives is set to `EXPIRED` with `failure_reason`
`NO_DLR` 24 hours after it was submitted (its `EXPIRED` event has
`"detail": {"reason": "NO_DLR"}`), and its webhook is sent then.

## Carrier callback

### `POST /carrier/dlr`

```json
{ "carrier_id": "c-8f2a…", "status": "DELIVRD", "timestamp": "2026-11-24T15:04:09Z" }
```

`X-Signature` is the hex HMAC-SHA256 of the raw request body with `DLR_SECRET`.

| Response | When                                                                    |
|----------|-------------------------------------------------------------------------|
| `401`    | Signature missing or wrong. Nothing is read from the body, nothing changes |
| `422`    | Signature is right but the body is not a valid DLR (including a `carrier_id` that is not valid text and a `timestamp` outside year 1 to 9999 in UTC) |
| `200`    | Always, once the DLR is stored. `{ "result": "applied" \| "pending" \| "duplicate" \| "ignored" }` |

## Internal API (dashboard)

Authentication: `X-Admin-Token: <ADMIN_TOKEN>`. The dashboard never sends this from
the browser; its Next.js server adds it when it proxies `/api/gateway/*`.

### `GET /internal/tenants`

```json
{ "data": [ { "id": "…", "slug": "acme-bank", "name": "Acme Bank", "currency": "USD",
              "balance_micros": 249000000, "opening_balance_micros": 250000000,
              "callback_url": "http://webhook-sink:9100/hooks/acme-bank",
              "api_key_prefix": "sk_acme_",
              "counts": { "ACCEPTED": 0, "QUEUED": 0, "SUBMITTED": 0, "DELIVERED": 0,
                          "UNDELIVERED": 0, "EXPIRED": 0, "FAILED": 0 },
              "total_messages": 0 } ] }
```

### `GET /internal/messages`

Query: `tenant_id`, `status`, `created_from`, `created_to`, `q` (exact match on
message ID, destination number or `client_ref`; a NUL character is a `422`),
`limit` (default 50, max 200), `cursor`. Times and cursors follow the rules of
`GET /v1/messages`. Returns `{ "data": [ <Message> ], "next_cursor": … }`, newest first.
Each `<Message>` here also has `"tenant_name"`.

### `GET /internal/messages/{id}`

```json
{
  "message": <Message with tenant_name>,
  "events":   [ <Event> ],
  "attempts": [ { "attempt_no": 1, "worker_id": "w-3f9a", "started_at": "…", "finished_at": "…",
                  "outcome": "ACCEPTED", "http_status": 200, "carrier_id": "c-…", "error": null } ],
  "dlrs":     [ { "id": 7, "carrier_id": "c-…", "status": "DELIVRD", "carrier_timestamp": "…",
                  "received_at": "…", "disposition": "APPLIED" } ],
  "ledger":   [ { "id": 1, "kind": "CHARGE", "amount_micros": 4000, "balance_after_micros": 0, "created_at": "…" } ],
  "webhooks": [ { "id": "…", "url": "…", "status": "DELIVERED", "attempts": 1, "last_http_status": 200,
                  "last_error": null, "created_at": "…", "delivered_at": "…", "next_attempt_at": "…" } ]
}
```

Attempt `outcome` is one of `ACCEPTED`, `RATE_LIMITED`, `UNAVAILABLE`, `REJECTED`,
`TIMEOUT`, `ABANDONED`, or `null` while the attempt is in flight.

### `POST /internal/tenants/{tenant_id}/messages`

Same body and response as `POST /v1/messages`. Sends as that tenant through exactly
the same code path (validation, price, charge, queue). Accepts `Idempotency-Key`.

### `GET /internal/prices`

```json
{ "data": [ { "prefix": "+880", "country": "Bangladesh", "price_per_segment_micros": 4000 } ] }
```

### `GET /internal/overview`

```json
{
  "queue": { "depth": 9120, "oldest_age_ms": 2140, "in_flight": 31 },
  "carrier": { "limit_per_second": 50, "target_per_second": 46.0 },
  "throughput": [ { "t": "2026-11-24T15:04:05Z", "submitted": 47, "finalized": 41 } ],
  "billing": [ { "tenant_id": "…", "consistent": true, "double_charged": 0 } ],
  "webhooks": { "pending": 12, "delivered": 4810, "dead": 0 }
}
```

`throughput` has one point per second for the last 60 seconds, oldest first.

### `GET /internal/stream` (Server-Sent Events)

Optional query `tenant_id`. `Content-Type: text/event-stream`. Three event types:

```
event: message
data: {"id":"019a…","tenant_id":"…","status":"SUBMITTED","occurred_at":"…","message":<Message with tenant_name>}

event: batch
data: {"batch_id":"…","tenant_id":"…","count":1000,"occurred_at":"…"}

event: stats
data: {"at":"…","tenants":[{"id":"…","balance_micros":0,"counts":{…},"total_messages":0}],
       "queue":{"depth":0,"oldest_age_ms":0,"in_flight":0},"rate":{"submitted_per_second":47,"finalized_per_second":41}}
```

`stats` is sent every second. A comment line (`: ping`) is sent every 15 seconds.
The stream is best-effort: after a reconnect the client refetches. It is a live
view, not a source of truth.

## Mock carrier

### `POST /submit`

```json
{ "message_id": "<gateway message id>", "to": "+8801711000001", "from": "ACME", "text": "...", "encoding": "GSM7" }
```

| Response                                   | Meaning                                            |
|--------------------------------------------|----------------------------------------------------|
| `200 { "carrier_id": "c-8f2a…" }`           | Accepted. A DLR follows                            |
| `429 { "error": "RATE_LIMITED" }`           | More than `RATE_LIMIT_PER_SEC` submits in 1 second |
| `503 { "error": "TEMPORARY_FAILURE" }`      | Not accepted. A retry can succeed                  |
| `400 { "error": "INVALID_DESTINATION" }`    | Not accepted. Permanent                            |
| (no answer for `TIMEOUT_SECONDS`, then `504`) | **Accepted**, and the DLR is still sent          |

Other routes: `GET /healthz`, `GET /stats`, `POST /reset`.

`GET /stats`:

```json
{ "received": 10650, "accepted": 10210, "rate_limited": 0, "temporary_failures": 320,
  "permanent_failures": 101, "timeouts": 104, "unique_message_ids_accepted": 10110,
  "duplicate_accepts": 100, "dlrs_sent": 11230, "dlrs_failed": 0,
  "max_submits_in_one_second": 49, "first_submit_at": "…", "last_submit_at": "…" }
```

`duplicate_accepts` counts accepted submits whose `message_id` had already been
accepted: each one is an SMS that would reach a real handset twice.

Environment variables (defaults in brackets):

| Variable               | Meaning                                                       |
|------------------------|---------------------------------------------------------------|
| `GATEWAY_URL`          | DLRs go to `{GATEWAY_URL}/carrier/dlr` [`http://gateway:8000`] |
| `DLR_SECRET`           | HMAC key for `X-Signature`                                    |
| `MIN_LATENCY_MS`, `MAX_LATENCY_MS` | Response time range [`20`, `300`]                 |
| `RATE_LIMIT_PER_SEC`   | Submits per sliding second before `429` [`50`]                |
| `P_TEMPORARY_FAILURE`  | Share of `503` [`0.03`]                                       |
| `P_PERMANENT_FAILURE`  | Share of `400` [`0.01`]                                       |
| `P_TIMEOUT`            | Share of accepted-but-silent submits [`0.01`]                 |
| `TIMEOUT_SECONDS`      | How long a timeout hangs [`5`]                                |
| `DLR_MIN_DELAY_MS`, `DLR_MAX_DELAY_MS` | DLR delay range [`500`, `10000`]              |
| `P_DELIVRD`, `P_UNDELIV`, `P_EXPIRED` | DLR status mix [`0.90`, `0.07`, `0.03`]        |
| `P_DLR_DUPLICATE`      | Share of DLRs sent twice [`0.10`]                             |
| `P_DLR_EARLY`          | Share of DLRs sent before the submit response [`0.05`]        |
| `IDEMPOTENT_SUBMIT`    | If `true`, a repeated `message_id` returns the first `carrier_id` and sends nothing new [`false`] |
| `RANDOM_SEED`          | Optional seed for a repeatable run                            |

## Webhook sink

`POST /hooks/{tenant_slug}` records the call and answers `200`. It can be made slow
or broken per tenant with `SINK_FAIL_<SLUG>` (share of `500`, for example
`SINK_FAIL_SHOPFAST=0.2`) and `SINK_DELAY_MS_<SLUG>` (`min-max`, for example
`SINK_DELAY_MS_SHOPFAST=200-1500`). `GET /stats` returns counts per tenant.

## Seed data

| Tenant    | Slug        | ID                                     | API key                         | Opening balance |
|-----------|-------------|----------------------------------------|---------------------------------|-----------------|
| Acme Bank | `acme-bank` | `0a000000-0000-4000-8000-000000000001` | `sk_acme_dev_3f9c1d7e5b2a4c68`  | 250.00 USD      |
| ShopFast  | `shopfast`  | `0a000000-0000-4000-8000-000000000002` | `sk_shop_dev_8e2b6a4f1c9d7053`  | 1,000.00 USD    |

These are development keys for a local demo. They are not secrets.

| Prefix | Country              | Price per segment |
|--------|----------------------|-------------------|
| `+880` | Bangladesh           | 4,000 micros (0.0040 USD)  |
| `+971` | United Arab Emirates | 21,000 micros (0.0210 USD) |
| `+63`  | Philippines          | 3,500 micros (0.0035 USD)  |
| `+44`  | United Kingdom       | 38,000 micros (0.0380 USD) |
| `+1`   | United States/Canada | 7,500 micros (0.0075 USD)  |

Admin token for the internal API in the local demo: `dev-admin-token`.
`DLR_SECRET` in the local demo: `dev-dlr-secret`.
