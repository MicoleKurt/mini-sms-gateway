# Workflow 5: fix-backend-review-findings

A workflow is a script that the main session wrote to run several sub-agents. The script below holds every prompt the sub-agents received. [Back to the index](../README.md).

| | |
|---|---|
| Started | 2026-11-25 00:40 (UTC+8) |
| Duration | 28.9 minutes |
| Sub-agents | 3 |
| Tool calls by sub-agents | 157 |
| Status | completed |
| Default model | claude-fable-5-2 |
| Run id | wf_e98addd8-782 |

## Phases

- **Fix** (model: opus): one engineer applies all confirmed findings, each with a test
- **Verify** (model: opus): a second engineer attacks each fix and re-runs everything
- **Repair** (model: opus): only if the verifier found something

## Summary

Apply the confirmed backend review findings with regression tests, then have a second agent verify every fix and the full suite

## Script

```js
export const meta = {
  name: 'fix-backend-review-findings',
  description: 'Apply the confirmed backend review findings with regression tests, then have a second agent verify every fix and the full suite',
  phases: [
    { title: 'Fix', detail: 'one engineer applies all confirmed findings, each with a test', model: 'opus' },
    { title: 'Verify', detail: 'a second engineer attacks each fix and re-runs everything', model: 'opus' },
    { title: 'Repair', detail: 'only if the verifier found something', model: 'opus' },
  ],
}

const ROOT = 'C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm'
const SCRATCH = 'C:\\Users\\Ico\\AppData\\Local\\Temp\\claude\\0aaf5675402adb95\\e1bcbcbb-6672-4634-a789-27e2e0879529\\scratchpad'

const COMMON = `
Project: a mini SMS gateway take-home (Python 3.11+, FastAPI, asyncpg, PostgreSQL, Valkey). Repository root: ${ROOT} (Windows 11, Git Bash; uv is installed; Docker is NOT installed).
Read first: ${ROOT}\\DESIGN.md, ${ROOT}\\docs\\API.md, ${ROOT}\\gateway\\migrations\\001_init.sql, all of ${ROOT}\\gateway\\src\\gateway\\ and ${ROOT}\\gateway\\tests\\conftest.py.

Rules:
  - Never run a git command. Never touch ${ROOT}\\dashboard (someone else is editing it).
  - Do NOT edit gateway/migrations/001_init.sql: it is applied in existing databases and its checksum is verified. A schema change goes into a new file gateway/migrations/002_<name>.sql.
  - Run the gateway tests only like this (this database is reserved for you; with TEST_REDIS_URL unset an in-process fake Redis is used):
        cd "${ROOT}/gateway" && TEST_DATABASE_URL=postgresql://smsgw@127.0.0.1:55432/smsgw_fix_test uv run pytest -q
    Do not use any other database and do not call services on localhost ports 8000, 9000, 9100, 3000 or 6399.
  - Lint and format must pass: "uv run ruff check ." and "uv run ruff format --check ." in ${ROOT}\\gateway (run "uv run ruff format ." to fix formatting).
  - Code style of this repository: small functions, a comment only where the WHY is not obvious, plain direct English, no emojis, no TODOs. Tests are named as sentences and assert behaviour, with the scenario in a docstring when it is not obvious.
  - Keep the public API and docs/API.md in step: if a response or behaviour changes, update docs/API.md, README.md and DESIGN.md where they describe it. Do not add claims the code does not back.
`

const WORK = `
The findings to fix are in ${SCRATCH}\\review_verdicts.json : an array of verdicts from an adversarial review, each with title, verdict (confirmed / partly / refuted), severity, reasoning, file and fix. Ignore the two "refuted" entries. Several entries describe the same defect: fix each defect once. Read every reasoning field fully: the skeptics corrected some of the first reviewers' fixes, and the "fix" field is the version to follow unless it is wrong.

The defects, de-duplicated, with the decision already made where the verdicts offered a choice:
  1. dispatch.record_accepted is not idempotent (a retried call erases the carrier_id). Fix as the verdict says (the attempt that owns the ID keeps it; carrier_id = COALESCE in _close_attempt). Also make a repeated record_retry not count an ambiguous attempt twice.
  2. dispatch.release_claim can undo a claim that another worker has since replaced (fence is not monotonic). Fix as the verdict says: the release must prove this worker's own attempt row is still open.
  3. Webhooks: a callback URL that the API accepts but httpx refuses is retried forever; some malformed URLs make PUT /v1/webhook answer 500. Make is_valid_callback_url agree with the client that will use the URL (ASCII, no whitespace or control characters, urlsplit and httpx.URL both accept it, http/https, a host), and make WebhookWorker._deliver treat ANY exception from the request as a failed attempt that is recorded, backed off and ends DEAD.
  4. Tenant and internal read endpoints answer 500 for hostile query values and forged cursors. Fix every case in the verdict (cursor length cap, RecursionError, datetime overflow, ledger cursor range, dates and limits) and add a last-resort handler so an unexpected exception returns the documented JSON error envelope with code INTERNAL_ERROR and status 500 instead of plain text (log the traceback; never leak it).
  5. A stalled Valkey makes POST /v1/messages hang after the charge is committed. Bound the publish with a short timeout and set socket timeouts on every Redis client the gateway creates.
  6. The claim statement's cost grows with the size of one tenant's backlog. Apply the reviewer's rewrite of next_tenant and picked in dispatch._CLAIM that the skeptic measured (LATERAL ... LIMIT 1 instead of EXISTS, and the form that lets messages_dispatch_idx supply the order). Verify with EXPLAIN (ANALYZE) in your database on at least 100,000 queued rows for one tenant with a few hundred leased rows at the front, and put the measured numbers in your report. Correct any sentence in DESIGN.md that the measurement contradicts.
  7. Metrics: drop the tenant label from smsgw_messages_accepted_total (the endpoint stays open for a scraper, so it must not expose per-tenant counts); refresh the queue gauges at scrape time; set METRICS_PORT for the dispatcher and webhooks services in docker-compose.yml and state accurately in README.md what is exposed where.
  8. POST /carrier/dlr can answer 500 for a correctly signed but hostile body (deep nesting, a carrier_id with an unpaired surrogate, an out-of-range timestamp). Make each a 422.
  9. A late 200 from a stale attempt after the message was FAILED and refunded: do not move money or status. Log an error, count it in a new metric, add the sentence to DESIGN.md question 1 and to the README trade-off, and add the test the verdict describes.
 10. The MAX_ATTEMPTS_EXCEEDED path (handle() failing a message without submitting) leaves its write-ahead attempt row open for ever. Remove that row and undo the attempt counter in the same transaction, only when the fenced failure was applied.
 11. A 429 answer is not recorded when the limiter penalty call fails. The penalty is best effort; recording the result is not. Fix and test.
 12. A message whose DLR never arrives stays SUBMITTED for ever. Implement the sweep: a small periodic task (in the webhook worker process, which already runs maintenance-like polling; keep it in its own module gateway/src/gateway/sweeper.py and start it from runner.run_webhooks) that moves messages which have been SUBMITTED for longer than a configurable validity period (setting dlr_wait_seconds, default 86400) to EXPIRED through lifecycle.finalize_from_dlr with detail {"reason": "NO_DLR"} and no refund, in batches with FOR UPDATE SKIP LOCKED, safe to run in several processes. A DLR that arrives afterwards is IGNORED by the existing compare-and-set. Test it (including that a late DLR after the sweep changes nothing and that a message inside the period is untouched). Update README.md ("Not done" list and assumptions) and DESIGN.md wording ("reaches one final status") to match what is now true.
 13. Tenant webhook signing secret cannot be read or set by a tenant. Return "signing_secret" from GET /v1/webhook and PUT /v1/webhook; PUT generates one with secrets.token_urlsafe(32) when the tenant has none. Document it in docs/API.md, including how to verify the signature.
 14. loadtest/load_test.py: the carrier-limit verdict cannot fail. Make it depend on rate_limited == 0 as well, and fix the sentence in loadtest/README.md, as the verdict says. (You may edit only those two files in ${ROOT}\\loadtest.)

Every code fix needs a regression test that fails before the fix and passes after it. Put tests in the existing test file for that area (test_dispatch.py, test_dlr.py, test_webhooks.py, test_send_api.py, test_isolation.py, test_live.py) or a new tests/test_hardening.py for the hostile-input cases.`

const report = await agent(`${COMMON}
YOU ARE THE ENGINEER WHO FIXES THE FINDINGS.
${WORK}

Work through them in order. After each one run the tests of that area; at the end run the full suite, ruff check and ruff format --check, and make all three pass.
Final report: for each of the 14 items, one or two lines: what you changed (file and function), the name of the regression test, and anything you decided differently from the verdict and why. Then the final test count line and the EXPLAIN measurements for item 6.`, { label: 'fix:backend-findings', phase: 'Fix', model: 'opus' })

const VERDICT = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          item: { type: 'integer' },
          status: { type: 'string', enum: ['fixed', 'not_fixed', 'fixed_with_problem'] },
          evidence: { type: 'string' },
          problem: { type: 'string' },
        },
        required: ['item', 'status', 'evidence'],
      },
    },
    full_suite: { type: 'string', description: 'the final pytest result line, and the ruff results' },
    regressions: { type: 'string', description: 'anything the fixes broke or made worse, or "none"' },
  },
  required: ['items', 'full_suite', 'regressions'],
}

const check = await agent(`${COMMON}
YOU ARE THE SECOND ENGINEER. Another engineer has just fixed 14 review findings. Do not trust the report: verify each fix in the code and by running things. You may write temporary tests (delete them when done), but do not change production code or the engineer's tests.
${WORK}

The engineer's report:
${String(report).slice(0, 12000)}

For each of the 14 items: read the changed code, find its regression test, and judge whether the test would really fail without the fix (reason about it; if unsure, write your own temporary test that reproduces the original scenario from review_verdicts.json and see that it now passes). Look for fixes that hide the symptom, new races, changed behaviour that the docs do not mention, and documentation sentences that are no longer true. Then run the full suite, ruff check and ruff format --check and report the exact result lines.
Be specific: "fixed_with_problem" needs the file, the line and what is wrong.`, { label: 'verify:backend-fixes', phase: 'Verify', schema: VERDICT, model: 'opus' })

const open = ((check && check.items) || []).filter(i => i.status !== 'fixed')
let repair = 'nothing to repair'
if (open.length || (check && check.regressions && !/^\s*none/i.test(check.regressions))) {
  repair = await agent(`${COMMON}
YOU ARE THE ENGINEER WHO FIXES THE FINDINGS, second pass. A verifier checked your work and reported the problems below. Fix each one properly, keep or add regression tests, then run the full suite, ruff check and ruff format --check and make all pass.
${WORK}

VERIFIER'S OPEN ITEMS:
${JSON.stringify(open, null, 2)}

REGRESSIONS REPORTED:
${check.regressions}

Final report: one line per open item (what you did), and the final test and lint result lines.`, { label: 'repair:backend-fixes', phase: 'Repair', model: 'opus' })
}

return { report: String(report).slice(0, 6000), check, repair: String(repair).slice(0, 3000) }

```

## What the sub-agents returned

Some reports below stop in the middle of a sentence. The script itself cut them (`.slice(0, N)`) before it returned them to the main session; nothing was cut when this file was made.

### report

```text
All 14 items are fixed. The full gateway suite passes, and so do `ruff check` and `ruff format --check`. For each code fix I confirmed that its regression test fails against a copy of the original source: I put that copy on PYTHONPATH and pointed it at the same migrations. No git commands were used. Nothing in `dashboard/` was touched, and `001_init.sql` is unchanged.

1. **Repeated `record_accepted` erased the carrier_id.** In `dispatch.py`, `record_accepted` now reads the owning `(message_id, attempt_no)`. The attempt that owns the ID keeps it. `_close_attempt` now writes `carrier_id = COALESCE($5, carrier_id)` and returns whether the row was still open. `record_retry` only adds to `ambiguous_attempts` when the row was still open, so a repeated call counts once.
   - Tests: `test_recording_an_acceptance_twice_keeps_the_carrier_id_for_the_dlr` and `test_recording_a_timeout_twice_counts_one_ambiguous_attempt`.
   - `test_an_idempotent_carrier_id_stays_on_the_attempt_that_got_it_first` is a guard; it passed before the fix too.

2. **Stale `release_claim` undid a newer claim.** `dispatch.release_claim(pool, msg, worker_id)` now releases only if this worker's own attempt row (same `attempt_no`, same `worker_id`) is still open. `Dispatcher._tick` passes `self.worker_id`, and the docstring is corrected.
   - Test: `test_a_stale_release_cannot_undo_a_newer_claim`.
   - Decision: I did not add the optional "release instead of send when close to the lease" check from the verdict.

3. **Webhook URLs httpx refuses.** `webhooks.is_valid_callback_url` now requires an ASCII URL with no whitespace or control characters. It must also pass `urlsplit` (including `.hostname` and `.port`) and `httpx.URL`, with scheme http/https and a host. `WebhookWorker._deliver` treats any `Exception` from the POST as a failed attempt, so it is recorded, backed off and ends DEAD.
   - Tests: `test_a_callback_url_the_client_cannot_request_is_a_422` (9 cases) and `test_a_stored_url_that_httpx_refuses_ends_dead_with_the_error_recorded`.
   - Consequence: a non-ASCII host is now refused; `docs/API.md` tells tenants to use the `xn--` form.

4. **Hostile read inputs answered 500.**
   - **Cursors (`queries.py`):** `decode_cursor` rejects cursors over 256 characters and catches `RecursionError`. The messages cursor converts its time to UTC and catches `OverflowError`. The ledger cursor must be in the bigint range.
   - **Dates and text filters (`api/tenant.py`):** `as_utc(value, field)` converts to UTC and returns a 422 on overflow. A new `storable_query` returns a 422 on NUL or a lone surrogate in `client_ref` and in `q` on `/internal/messages`. `client_ref` on GET is limited to 1 to 64 characters. `validation._is_storable` is renamed to `is_storable`.
   - **Last-resort handler (`errors.py`):** `InternalErrorMiddleware` logs the traceback and returns `{"error":{"code":"INTERNAL_ERROR",...}}` with status 500.
   - Decision: it is a plain ASGI middleware, not `exception_handler(Exception)`. Starlette re-raises after such a handler, and this approach also leaves the SSE stream unbuffered.
   - Tests in `tests/test_hardening.py`: `test_hostile_message_list_queries_are_a_422`, `test_a_forged_ledger_cursor_is_a_422`, `test_hostile_internal_list_queries_are_a_422`, `test_an_unexpected_error_is_a_json_500_without_the_traceback`, plus `test_a_time_with_an_offset_still_filters_correctly`. Invalid `limit` values were already a 422; they are now covered.

5. **A stalled Valkey hung the send.** `LivePublisher.publish` is wrapped in `asyncio.wait_for(..., 0.25)`. A new `gateway/valkey.py` provides `connect` (socket and connect timeouts, from the new setting `redis_timeout_seconds`, default 1.0) and `connect_subscriber` (connect timeout plus keepalive, but no read timeout, since an idle pub/sub must not time out). Both `api/app.py` (a separate client for `LiveHub`) and `runner.run_dispatcher` use them.
   - Tests in `test_live.py`: `test_a_valkey_that_never_answers_does_not_hold_up_a_send` (a real redis-py client against a silent TCP server; the 202 must come in under 1 s), `test_a_publish_that_never_returns_is_given_up` and `test_every_command_client_has_socket_timeouts`.

6. **Claim cost grew with one tenant's backlog.** In `dispatch._CLAIM`, `next_tenant` is now a LATERAL `... LIMIT 1` instead of EXISTS. Both `next_tenant` and `picked` use `tenant_id >= X AND tenant_id <= X ORDER BY tenant_id, id`, with a comment explaining why. `queries.queue_stats` uses the same form. DESIGN.md section 3 now states the measured one-probe-per-tenant cost.
   - Test: `test_the_claim_plan_does_not_walk_a_large_backlog` (20,000 rows; ANALYZE; half sent; asserts no Seq Scan on messages and two `messages_dispatch_idx` scans).

7. **Metrics.**
   - **Tenant label:** removed from `smsgw_messages_accepted_total` (`metrics.py`, `api/tenant.py`, `api/internal.py`).
   - **Scrape-time gauges:** `/metrics` in `api/app.py` calls `queries.queue_stats` before rendering; if the database is unreachable it logs a warning and still serves.
   - **Compose:** `docker-compose.yml` sets `METRICS_PORT=9464` for dispatcher and webhooks; the port is not published on the host because two replicas would clash.
   - **README:** a table now says what is exposed where.
   - Tests: `test_open_metrics_do_not_name_tenants` (`test_isolation.py`) and `test_metrics_report_the_queue_as_it_is_at_scrape_time` (`test_live.py`).

8. **Hostile signed DLR bodies.** `api/carrier_callbacks._parse` catches `RecursionError`, and `carrier_id` must pass `is_storable`. A new `_parse_timestamp` converts to UTC and catches `ValueError` and `OverflowError`. All three cases are now a 422.
   - Tests: `test_a_signed_but_hostile_dlr_is_a_422` (4 cases) and `test_a_dlr_timestamp_with_an_offset_is_stored_as_the_same_instant`.

9. **Late 200 after FAILED.** `dispatch._report_late_acceptance` runs when `transition()` returns None. If the message is FAILED it logs an ERROR and increments the new counter `smsgw_acc
```

### check

```json
{
  "items": [
    {
      "item": 1,
      "status": "fixed",
      "evidence": "dispatch.py:262-275: record_accepted reads (message_id, attempt_no) of the owner; mine = same message and same attempt_no, so the owning attempt keeps the ID. _close_attempt (218-245) writes carrier_id = COALESCE($5, a.carrier_id) and returns whether the row was open (CTE 'before' sees the pre-update row). record_retry (310-328) adds the ambiguous count only when was_open. Tests test_recording_an_acceptance_twice_keeps_the_carrier_id_for_the_dlr and test_recording_a_timeout_twice_counts_one_ambiguous_attempt both fail on the baseline copy and pass now. I also wrote a temporary test that goes through the real Dispatcher.handle/_with_retries path: record_accepted commits and then raises ConnectionDoesNotExistError, it is called twice, and the DLR afterwards returns 'applied' and the message becomes DELIVERED. It passed; the test was deleted afterwards. Side effect, as the verdict said: a repeated call returns [], so the SUBMITTED live event is not sent again. The stream is best effort, so this is acceptable."
    },
    {
      "item": 2,
      "status": "fixed",
      "evidence": "dispatch.py:170-195: the release UPDATE requires EXISTS(the attempt row with attempt_no=$2, outcome IS NULL and worker_id=$3). _tick (line 441) passes self.worker_id. Under READ COMMITTED, if a concurrent claim commits first, EvalPlanQual rechecks m.attempts, so the race window is covered too. test_a_stale_release_cannot_undo_a_newer_claim fails on the baseline and passes now. I also ran a temporary test that uses only Dispatcher._tick: a slow worker's acquire blocks and then raises, the lease expires, a fast worker claims and releases, then the slow worker releases. Result: attempts stayed 1 and a healthy dispatcher then SUBMITTED the message. It passed; deleted afterwards. The optional 'release when close to the lease' check is not implemented, which was declared."
    },
    {
      "item": 3,
      "status": "fixed",
      "evidence": "webhooks.py:41-59: the URL must be ASCII, have no whitespace or non-printable character, and pass urlsplit, .hostname, .port and httpx.URL, with scheme http/https and a host. webhooks.py:212-220: `except Exception` around the POST records the error, so the delivery is backed off and ends DEAD. test_a_callback_url_the_client_cannot_request_is_a_422 (9 cases) and test_a_stored_url_that_httpx_refuses_ends_dead_with_the_error_recorded fail on the baseline and pass now. My own check: 16 edge URLs (empty port, %00 in the host, a..b, userinfo, IPv6, port 0, upper-case scheme, fragment, underscore, '*'). Every URL the validator accepts was built by httpx build_request without an error, and port 99999 and a space are refused. Changed behaviour (a non-ASCII host is now a 422) is documented in docs/API.md:189-192."
    },
    {
      "item": 4,
      "status": "fixed",
      "evidence": "queries.py:36-46 (length cap of 256 and RecursionError), 97-106 (cursor time converted to UTC, OverflowError caught), 169-175 (ledger id must be within 0..2^63-1). api/tenant.py:32-63 (as_utc with the field name, storable_query) and 131 (client_ref 1..64). internal.py:60-62. errors.py:77-109 InternalErrorMiddleware returns {error:{code:INTERNAL_ERROR,message:'Internal error.'}} with status 500, logs the traceback and leaves a started stream alone. docs/API.md:37 has INTERNAL_ERROR. All 21 test_hardening read cases fail on the baseline and pass now. I also sent 30 more hostile values in a temporary test, and none returned a 500 or a non-JSON body: cursors 'é', '====', invalid UTF-8, a lone surrogate inside JSON, a dict, nested lists, 1e999, a 9999-12-31 time at -00:01; ledger cursors '1e5', Arabic-Indic digit, 2^63, 5000 digits, null; created_from +10000 and year 0; a bad batch_id or status; internal q ' \\x00 '; a bad tenant_id; message ids with %00 in the path. The temporary test was deleted afterwards."
    },
    {
      "item": 5,
      "status": "fixed",
      "evidence": "live.py:31-38: asyncio.wait_for(publish, 0.25). valkey.py: connect() sets socket_timeout and socket_connect_timeout (redis_timeout_seconds, default 1.0). connect_subscriber() sets a connect timeout and keepalive and no read timeout, used only for the LiveHub subscription. app.py:44-46 and runner.py:48 use them; a grep finds no other client. The test_live tests (a real redis-py client against a silent TCP server, a hanging publish, and the client kwargs) fail on the baseline and pass now. I also ran two temporary tests against a silent TCP server: with the production clients built by create_app, /readyz answered 503 in under 2 s, and RateLimiter.acquire on connect() raised instead of hanging. Both passed; deleted afterwards."
    },
    {
      "item": 6,
      "status": "fixed",
      "evidence": "dispatch.py:95-122: next_tenant is CROSS JOIN LATERAL(... ORDER BY m.tenant_id, m.id LIMIT 1) and picked uses the range form, with an explanatory comment at 82-87; queries.queue_stats (249-257) uses the same form. My own measurement script was verify_claim_plan.py in the scratchpad, with output in verify_claim_out.txt. Each case was 7 EXPLAIN (ANALYZE, BUFFERS) runs in a rolled-back transaction on PostgreSQL 16.14 in smsgw_fix_test, with ShopFast served next. Medians: (1) 100,000 QUEUED for ShopFast plus 20 Acme, first 300 leased, fresh VACUUM ANALYZE: old 0.33 ms (picked = messages_pkey, 320 rows removed by filter), new 0.27 ms. (2) Same rows with the first 5,000 leased: old 0.43 ms, new 0.51 ms (114 buffers; the cost grows with leased or backing-off rows at the front, not with the backlog behind). (3) 100,000 QUEUED behind 100,000 sent, 300 leased, statistics from before, no vacuum: old 20.12 ms (messages_pkey, 100,320 rows removed by filter, 41,616 buffers), new 1.35 ms (4,346 buffers, dead index entries). (4) Same rows after VACUUM ANALYZE: old 13.09 ms (messages_pkey, 100,320 removed), new 0.30 ms (64 buffers). The new next_tenant was an Index Only Scan on messages_dispatch_idx in every case. No Seq Scan/HashAggregate appeared. This matches the engineer's numbers and the DESIGN.md:117-122 sentence ('0.3 ms after a vacuum and 1.5 ms before one ... 13 and 21 ms'). test_the_claim_plan_does_not_walk_a_large_backlog fails on the baseline and passes now. Nit: DESIGN 'its cost does not grow with a backlog' is true for the backlog behind the first ready row. Leased or backing-off rows in front of it are still read, as case 2 shows."
    },
    {
      "item": 7,
      "status": "fixed",
      "evidence": "metrics.py:12 MESSAGES_ACCEPTED has no labels, and all three callers use .inc(). app.py:87-95 calls queries.queue_stats before generate_latest and only warns on failure. docker-compose.yml sets METRICS_PORT '9464' for dispatcher and webhooks and does not publish it. README.md:138-143 says what is exposed where, and I found it accurate: the sweep counter is in the webhook process, the late-accept counter in the dispatcher, DLR delay only for DLRs the API applied. A grep found no other consumer of the tenant label (dashboard included). test_open_metrics_do_not_name_tenants and test_metrics_report_the_queue_as_it_is_at_scrape_time fail on the baseline and pass now. Nit: the worker processes also export smsgw_queue_depth and smsgw_submits_in_flight, and these stay 0 there because they are never set in those processes. The README does not claim otherwise."
    },
    {
      "item": 8,
      "status": "fixed",
      "evidence": "carrier_callbacks.py:51-56 catches RecursionError, 64-71 uses is_storable(carrier_id), and 89-101 _parse_timestamp converts to UTC and catches ValueError/OverflowError, so the result is a 422 with field timestamp. All 4 test_a_signed_but_hostile_dlr_is_a_422 cases fail on the baseline and pass now, and dlr_receipts stays empty. I also sent 8 more signed hostile bodies in a temporary test, all 200/422 JSON and never a 500: invalid UTF-8, a 5000-digit integer, 50,000-deep nesting inside a valid object, status as a list, +24:00 offset, a naive year-1 time, \\u0000 in carrier_id, NaN. docs/API.md:234 updated."
    },
    {
      "item": 9,
      "status": "fixed",
      "evidence": "dispatch.py:285-307: when transition() returns None, _report_late_acceptance reads the status, and if it is FAILED it increments smsgw_accepted_after_failed_total and logs at ERROR. It changes no money and no status. test_a_late_acceptance_after_the_message_failed_moves_no_money asserts FAILED/INVALID_DESTINATION, ledger [CHARGE, REFUND], balance restored, books balanced, DLR 'ignored', metric +1 and the log line. It fails on the baseline (the metric part) and passes now. The new sentence is in DESIGN.md:71-78 and README.md:347-351."
    },
    {
      "item": 10,
      "status": "fixed",
      "evidence": "dispatch.py:356-378: only when change is not None and result is None (the fenced failure was applied), _undo_unsent_attempt deletes the open row and lowers attempts by one in the same transaction, after fail_message, and returns the corrected row for the live event. test_failing_for_max_attempts_without_a_submit_leaves_no_attempt_in_flight (FAILED, attempts 2, rows [(1,ABANDONED),(2,ABANDONED)], in_flight 0, books balance) fails on the baseline and passes now. Nit: the FAILED event detail is built at line 337 before the undo, so it still says {'attempt': 3} while messages.attempts is 2 and there is no attempt row 3."
    },
    {
      "item": 11,
      "status": "fixed",
      "evidence": "dispatch.py:502-503 and 522-532: Dispatcher._penalize catches any exception from limiter.penalize and logs a warning, and the record_* call always follows. test_a_429_is_recorded_even_when_the_penalty_cannot_be_applied asserts [(1,RATE_LIMITED)] after the first tick, then SUBMITTED with ambiguous_attempts 0 and [(1,RATE_LIMITED),(2,ACCEPTED)]. It fails on the baseline and passes now."
    },
    {
      "item": 12,
      "status": "fixed",
      "evidence": "New gateway/src/gateway/sweeper.py: _DUE selects SUBMITTED rows with submitted_at older than the wait period, ORDER BY submitted_at LIMIT n FOR UPDATE SKIP LOCKED. Each one goes through lifecycle.finalize_from_dlr(EXPIRED, detail {'reason':'NO_DLR'}, failure_reason NO_DLR), with no ledger change. sweep() loops in batches, and DlrSweeper.run is started by runner.run_webhooks in a TaskGroup. Settings: dlr_wait_seconds=86400, interval 60, batch 500. Migration 002_submitted_sweep_idx.sql is applied in the test database (schema_migrations has 001_init and 002_submitted_sweep_idx), and 001 is unchanged. Lock order: the sweep takes only message row locks, and the DLR and record paths take the advisory lock and then the message row, so there is no deadlock cycle. A late DLR waits and is then IGNORED. The 4 tests in test_dlr.py fail on the baseline and pass now: expiry after the period with no refund and one webhook; a message inside the period untouched; a DLR after the sweep 'ignored' with the row unchanged; 3 concurrent sweeps expire each message exactly once; the loop stops on stop. README: the Not done entry is removed, the assumption at 352-356 is added, the state diagram (line 105) and layout (line 314) are updated. DESIGN.md:55-58 and docs/API.md:217-219 match the code."
    },
    {
      "item": 13,
      "status": "fixed",
      "evidence": "api/tenant.py:186-210: GET returns signing_secret, and PUT runs webhook_secret = COALESCE(webhook_secret, 'whsec_' + secrets.token_urlsafe(32)) RETURNING both fields. test_a_tenant_can_read_its_signing_secret and test_a_tenant_without_a_secret_gets_one_and_can_verify_its_callbacks (the secret is stable across PUTs and the X-Signature verifies) fail on the baseline and pass now. docs/API.md:175-215 documents the field, the generation rule and verification with a code sample. Minor and harmless: a PUT with callback_url null also generates a secret. The 'whsec_' prefix is beyond the brief and was declared."
    },
    {
      "item": 14,
      "status": "fixed",
      "evidence": "loadtest/load_test.py:803-808: within = rate_limited == 0 and peak <= CARRIER_LIMIT_PER_SECOND. loadtest/README.md:144-147 now says the peak is of admitted submits, cannot exceed the limit, and that the line also checks rate_limited. The file parses, and ruff check passes on it. As the engineer said, there is no regression test because loadtest has no suite."
    }
  ],
  "full_suite": "Gateway suite after my temporary test file was deleted: \"173 passed in 24.07s\" (earlier run: \"173 passed in 22.57s\"). `uv run ruff check .` gives \"All checks passed!\". `uv run ruff format --check .` gives \"46 files already formatted\". `ruff check ../loadtest/load_test.py` gives \"All checks passed!\". For comparison, the same 173 tests run against the engineer's baseline copy gave \"46 failed, 127 passed\": every new regression test fails there. That copy had been lightly edited (mine=False, _close_attempt returns True, a worker_id default on release_claim) so the new tests can import and call it, so I also checked by reasoning that each test exercises the original defect.",
  "regressions": "I found no regressions. These behaviour changes are intended and documented: a non-ASCII callback host is now a 422 (use the xn-- form); GET /v1/messages?client_ref= with an empty value is now a 422 instead of an empty list; /v1/webhook responses include signing_secret.\n\nNits, none blocking:\n(a) dispatch.py:337: the FAILED event detail on the MAX_ATTEMPTS path says attempt N+1 after the counter was lowered to N.\n(b) DESIGN.md:117-119: the claim still reads leased or backing-off rows in front of the first ready one. 5,000 leased rows at the front gave 0.51 ms against 0.27 ms. The backlog behind does not matter.\n(c) The worker metrics endpoints export smsgw_queue_depth and smsgw_submits_in_flight as a constant 0.\n\nMy measurement script and its output are in the scratchpad: verify_claim_plan.py and verify_claim_out.txt. The run truncated smsgw_fix_test at the end, and the test fixtures re-seed it."
}
```

### repair

```text
The verifier listed no open items and no regressions. Its three non-blocking nits are now fixed, each with a regression test that fails without the fix.

- **Nit (a), wrong attempt in the FAILED event:** in `record_failed` (`gateway/src/gateway/dispatch.py`), when there is no submit result (the MAX_ATTEMPTS_EXCEEDED path), the event detail now says `"attempt": msg.attempt - 1`. That is the last attempt actually made, and it matches the counter after `_undo_unsent_attempt`. Test: `test_failing_for_max_attempts_without_a_submit_leaves_no_attempt_in_flight` in `gateway/tests/test_dispatch.py` now also asserts the FAILED event's detail attempt is 2. Before the fix it was 3.
- **Nit (b), DESIGN.md claim sentence:** section 3 now says that only the backlog behind the first ready message does not add to the cost. The claim still reads the leased or backing-off rows in front of it. I took the numbers from the verifier's run in `C:\Users\Ico\AppData\Local\Temp\claude\0aaf5675402adb95\e1bcbcbb-6672-4634-a789-27e2e0879529\scratchpad\verify_claim_out.txt` and did not measure again:

| Case (100,000 queued for one tenant) | New claim | Earlier version |
|---|---|---|
| 300 leased rows at the front | 0.27 ms | 0.33 ms |
| 5,000 leased rows at the front | 0.51 ms | 0.43 ms |
| Behind 100,000 sent, after VACUUM | 0.30 ms | 13 ms |
| Behind 100,000 sent, before VACUUM | 1.35 ms | 20 ms |

- **Nit (c), workers exported the queue gauges as a constant 0:** `smsgw_queue_depth` and `smsgw_submits_in_flight` now live in their own registry, `metrics.API_ONLY`, in `gateway/src/gateway/metrics.py`. The API's `/metrics` serves the default registry plus that one, in `gateway/src/gateway/api/app.py`. Workers serve only the default registry, so they no longer show these gauges. README.md's metrics table now says the queue gauges are only on the API. New test: `test_a_worker_metrics_endpoint_does_not_export_the_queue_gauges` in `gateway/tests/test_live.py`. The existing test that the API reports the depth at scrape time still passes.

Final results:
- `TEST_DATABASE_URL=postgresql://smsgw@127.0.0.1:55432/smsgw_fix_test uv run pytest -q`: 174 passed in 22.15s
- `uv run ruff check .`: All checks passed!
- `uv run ruff format --check .`: 46 files already formatted
```
