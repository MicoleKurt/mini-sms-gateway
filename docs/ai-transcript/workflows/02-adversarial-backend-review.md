# Workflow 2: adversarial-backend-review

A workflow is a script that the main session wrote to run several sub-agents. The script below holds every prompt the sub-agents received. [Back to the index](../README.md).

| | |
|---|---|
| Started | 2026-11-24 23:56 (UTC+8) |
| Duration | 42.6 minutes |
| Sub-agents | 10 |
| Tool calls by sub-agents | 380 |
| Status | completed |
| Default model | claude-fable-5-2 |
| Run id | wf_9a33f00f-c22 |

## Phases

- **Find**: money, delivery, fairness and rate, API and security, spec and docs
- **Verify**: a skeptic tries to refute every finding

## Summary

Five reviewers try to break the gateway from different angles; each finding is then attacked by a skeptic before it counts

## Log lines

```text
21 findings survived, 2 refuted
```

## Script

```js
export const meta = {
  name: 'adversarial-backend-review',
  description: 'Five reviewers try to break the gateway from different angles; each finding is then attacked by a skeptic before it counts',
  phases: [
    { title: 'Find', detail: 'money, delivery, fairness and rate, API and security, spec and docs' },
    { title: 'Verify', detail: 'a skeptic tries to refute every finding' },
  ],
}

const ROOT = 'C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm'
const SCRATCH = 'C:\\Users\\Ico\\AppData\\Local\\Temp\\claude\\0aaf5675402adb95\\e1bcbcbb-6672-4634-a789-27e2e0879529\\scratchpad'

const CONTEXT = `
You are reviewing a take-home project: a mini SMS gateway (Python 3.11+, FastAPI, asyncpg, PostgreSQL, Valkey/Redis, plus a mock carrier and a load script). Repository root: ${ROOT} (Windows 11, Git Bash; uv is installed; Docker is NOT installed).

Read first, fully:
  - the assignment text:  ${SCRATCH}\\assignment.txt   (this is what the graders check against)
  - ${ROOT}\\DESIGN.md, ${ROOT}\\docs\\API.md, ${ROOT}\\gateway\\migrations\\001_init.sql
  - the gateway source: ${ROOT}\\gateway\\src\\gateway\\ (all of it: it is about 2,500 lines) and its tests in ${ROOT}\\gateway\\tests\\

Grading weights from the assignment: correctness under failure 25%, data model and billing integrity 20%, throughput and fairness 15%, API design/validation/tenant isolation 10%, dashboard 10%, tests 10%, docs 10%. "A partial solution that is correct is better than a complete solution that loses messages or money."

Rules:
  - Do NOT edit any existing file. Do NOT run any git command. Do NOT touch the databases "smsgw" or "smsgw_test" and do NOT call the services on localhost ports 8000, 9000, 9100, 3000, 6399 (a load test is running on them).
  - You MAY prove a finding by writing a NEW test file at ${ROOT}\\gateway\\tests\\test_review_LENS.py (LENS = your lens name) and running it with:
        cd "${ROOT}/gateway" && TEST_DATABASE_URL=postgresql://smsgw@127.0.0.1:55432/smsgw_review_LENS_test uv run pytest tests/test_review_LENS.py -q
    (that database is yours alone; with TEST_REDIS_URL unset the tests use an in-process fake Redis). Reuse the fixtures and helpers in tests/conftest.py. DELETE your test file before you finish, and paste the essential part of the reproducing test into the finding's "evidence".
  - Report only defects that are real: something that loses or duplicates a message, loses or creates money, breaks a stated requirement, leaks data across tenants, deadlocks, gets stuck forever, or a statement in the docs that the code contradicts. Each finding needs the file and line, the exact scenario (step by step), what happens, what should happen, and a concrete fix.
  - Not findings: style, naming, "could add more tests", hypothetical scaling concerns that DESIGN.md already admits, anything listed under "Not done" in README.md or "Assumptions and trade-offs" in DESIGN.md (unless the code contradicts what is written there).
  - Rank by severity. At most 8 findings. If you find nothing real in your lens, return an empty list: that is a valid and useful result.
`

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          file: { type: 'string' },
          line: { type: 'integer' },
          scenario: { type: 'string' },
          impact: { type: 'string' },
          evidence: { type: 'string', description: 'reproducing test or the exact code path, quoted' },
          fix: { type: 'string' },
          reproduced: { type: 'boolean', description: 'true only if you ran something that showed the defect' },
        },
        required: ['title', 'severity', 'file', 'scenario', 'impact', 'evidence', 'fix', 'reproduced'],
      },
    },
  },
  required: ['findings'],
}

const VERDICTS = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          verdict: { type: 'string', enum: ['confirmed', 'refuted', 'partly'] },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          reasoning: { type: 'string' },
          file: { type: 'string' },
          fix: { type: 'string', description: 'the fix you would apply, corrected if the reviewer got it wrong' },
        },
        required: ['title', 'verdict', 'severity', 'reasoning', 'file', 'fix'],
      },
    },
  },
  required: ['verdicts'],
}

const LENSES = [
  {
    key: 'money',
    prompt: `LENS: money. Try to make the books wrong. Targets: gateway/src/gateway/accept.py, billing.py, lifecycle.py, dispatch.py (record_failed, release_claim), queries.py (ledger, balance), the ledger and idempotency tables.
Attack ideas: two requests with the same Idempotency-Key at once, with different bodies, across the single and batch endpoints; a key replay after the row was written but the transaction rolled back; concurrent charges and refunds on one tenant (lock order, deadlocks between accept / fail / DLR transactions); a batch where the running balance_after is wrong; a refund that can happen twice or not at all (stale worker, max attempts on an ambiguous attempt, release_claim racing with a result); a message that ends FAILED without a refund or ends non-FAILED with one; integer overflow or negative cost; the invariant balance = opening - sum(ledger) at every commit boundary; the request fingerprint (can two different requests hash the same, or the same request hash differently?); the /v1/balance "consistent" flag read under concurrent writes.`,
  },
  {
    key: 'delivery',
    prompt: `LENS: delivery correctness under failure. Try to lose a message, deliver it twice without the system knowing, move a status backwards, or leave a message stuck forever. Targets: gateway/src/gateway/dispatch.py, dlr.py, messages.py (transition), lifecycle.py, retry.py, carrier.py, webhooks.py, status.py.
Attack ideas: every crash point in the dispatcher (after claim, after token, mid-HTTP, after HTTP before record, mid-record); lease expiry while a slow attempt is still in flight and both attempts finish in every order (200/200, 200/503, 503/200, 400/200, 200/400, timeout/200); the release_claim path (does it ever undo a claim whose request WAS sent? cancellation during the HTTP call? shutdown?); a DLR that arrives before, during and after the submit response is recorded, for the first and for a second accepted attempt; a DLR for a carrier_id that is attached to an attempt whose message is FAILED; two different DLR statuses for one carrier_id; the advisory lock (hash collisions, lock order with row locks, can it deadlock with the accept or fail transactions?); messages that can never leave QUEUED or SUBMITTED (for example: no DLR ever arrives; is that a stated limitation?); the retry decision at the boundaries (attempt == max_attempts, 429 with Retry-After, ambiguous then permanent); webhook outbox: a final state without a webhook, a webhook sent for a non-final state, deliveries stuck PENDING forever, the claim lease shorter than a slow delivery; graceful shutdown.`,
  },
  {
    key: 'fairness',
    prompt: `LENS: fairness, the carrier rate limit and throughput. Targets: gateway/src/gateway/limiter.py (the Lua scripts: do the maths by hand for burst 1, 2, 3 and for a wait), dispatch.py (the _CLAIM statement and Dispatcher._tick), config.py, queries.py (the per-second statistics), the dispatch index in the migration, and ${ROOT}\\loadtest\\load_test.py plus ${ROOT}\\mock-carrier\\src\\mock_carrier\\ (rate_limit.py, submit.py).
Attack ideas: can more than carrier_rate_limit submits reach the carrier in any one-second window with N workers (token granted but request delayed; penalty logic; the key expiring; Redis restart; clock source); does the _CLAIM statement do what its comment says under concurrency (FOR UPDATE SKIP LOCKED inside CTEs with LIMIT, the EXISTS probe versus rows locked by other workers, a tenant whose only ready rows are locked: is its turn burned? can a tenant starve?); correctness of the claim when a data-modifying CTE finds no row; is ORDER BY m.id really served by the index (run EXPLAIN on your review database with a few thousand rows and many leased rows at the front); cost of the claim when thousands of rows at the front of a tenant's queue are invisible (backing off); the OTP path: worst-case wait with 2 workers and 2 tenants, with 50 tenants; idle polling cost; the in-flight cap (worker_max_in_flight) versus the 5 s carrier timeouts: can timeouts exhaust the cap and stall dispatch?; the load script: does it compute what the assignment asks (total time, average submit rate to the carrier, OTP accept-to-SUBMITTED p50/p95, final state counts, billing check), is its percentile right, can it report PASS when something is wrong, can it hang?`,
  },
  {
    key: 'api',
    prompt: `LENS: API design, validation, tenant isolation and security. Targets: gateway/src/gateway/api/*.py, errors.py, validation.py, models.py, queries.py, live.py, accept.py, webhooks.py (callback URL), dlr.py (signature), migrate.py, seed.py.
Attack ideas: any route where tenant A can see or affect tenant B (list filters, cursors forged from another tenant, batch_id, client_ref, ledger cursor, message detail, webhook settings, SSE stream, error messages that reveal existence); the internal API guard and whether any internal route is reachable without the token; timing and comparison of secrets; SQL built by string formatting in queries.py (is any user input ever interpolated?); inputs that make the server return 500 instead of a clean 4xx: write tests that throw hostile input at every endpoint (wrong JSON types, null, arrays, huge strings, NUL bytes, lone surrogates, 10 MB bodies, 1001-item batches, a non-UTF-8 body, bad cursors, bad dates, naive dates, bad UUIDs, negative or huge limit, a header with non-ASCII bytes, Idempotency-Key of 300 characters or empty) and report every 500; E.164 and sender validation edge cases; the DLR endpoint (raw-body signature check before parsing, replay of an old signed DLR, malformed JSON with a valid signature, giant carrier_id, timestamps); response shapes versus docs/API.md (field names, status codes, the error envelope on EVERY error path including 404 for unknown routes and 405); idempotent replay returning the same status code and body; anything in docs/API.md that the code does not do.`,
  },
  {
    key: 'spec',
    prompt: `LENS: requirement coverage and truthfulness of the documents. Go through the assignment text line by line (Parts 1 and 2, Technical requirements, Data model, Testing, Design note, Submission) and check each requirement against the code. Then check that README.md, DESIGN.md and docs/API.md say only things the code actually does.
Also review statically (Docker is not installed, so read carefully): ${ROOT}\\docker-compose.yml, ${ROOT}\\gateway\\Dockerfile, ${ROOT}\\mock-carrier\\Dockerfile, ${ROOT}\\docker\\postgres-init.sql, ${ROOT}\\.github\\workflows\\ci.yml. Look for things that would make "docker compose up" fail or misbehave on a clean Linux machine: wrong paths or build contexts, files a Dockerfile copies that do not exist or are excluded by .dockerignore, a non-root user that cannot read the venv, missing env vars, a healthcheck that can never pass, depends_on conditions that deadlock, the "replicas" key, the tests service (does it find the shared vectors file? does TEST_REDIS_URL database 15 isolate it?), the loadtest service path, ports, the uv image tag, python version versus the lock file, CRLF line endings in files that Linux will execute, the CI steps (will each command work on ubuntu-latest?).
For the mock carrier (${ROOT}\\mock-carrier\\src\\mock_carrier\\) check every behaviour and percentage in "Part 1: Mock carrier" of the assignment, including that each value is configurable by environment variable.
Report: requirements that are missing or only partly met, claims in the docs that are false or overstated (quote the sentence and the code that contradicts it), and anything that would break the one-command start. The dashboard directory is still being built by someone else: do not review ${ROOT}\\dashboard. README.md contains the marker <!-- LOAD_OUTPUT --> and screenshot links that are filled in later: ignore those.`,
  },
]

function db(prompt, key) {
  return prompt.split('LENS').join(key)
}

const results = await pipeline(
  LENSES,
  lens => agent(`${db(CONTEXT, lens.key)}\n${lens.prompt}`, { label: `find:${lens.key}`, phase: 'Find', schema: FINDINGS }),
  (found, lens) => {
    const findings = (found && found.findings) || []
    if (!findings.length) return { lens: lens.key, findings: [], verdicts: [] }
    return agent(`${db(CONTEXT, lens.key)}
You are the SKEPTIC for the "${lens.key}" review. Another reviewer produced the findings below. Your job is to try to REFUTE each one. Assume the reviewer may have misread the code, missed a constraint in the migration, missed a WHERE clause, or described a scenario that cannot happen.
For each finding: read the code it points at and everything that code depends on; if it can be tested, write the test (same rules and the same private database as above; delete your test file when done) and run it. A finding is "confirmed" only if you can state the concrete sequence of events and it really leads to the claimed result in the current code. "partly" means the defect is real but smaller or different than claimed: say exactly what is true. "refuted" means it does not happen: say which line prevents it. Re-grade the severity yourself (critical = loses/duplicates money or messages silently; high = breaks a stated requirement or leaks across tenants; medium = wrong behaviour in an edge case or a false statement in the docs; low = minor). Give the fix you would actually apply.

FINDINGS TO ATTACK:
${JSON.stringify(findings, null, 2)}`, { label: `verify:${lens.key}`, phase: 'Verify', schema: VERDICTS })
      .then(v => ({ lens: lens.key, findings, verdicts: (v && v.verdicts) || [] }))
  },
)

const all = results.filter(Boolean)
const confirmed = all.flatMap(r => r.verdicts.filter(v => v.verdict !== 'refuted').map(v => ({ lens: r.lens, ...v })))
const refuted = all.flatMap(r => r.verdicts.filter(v => v.verdict === 'refuted').map(v => ({ lens: r.lens, title: v.title, reasoning: v.reasoning })))
log(`${confirmed.length} findings survived, ${refuted.length} refuted`)
return { confirmed, refuted, raw_counts: all.map(r => ({ lens: r.lens, found: r.findings.length })) }

```

## What the sub-agents returned

### confirmed

```json
[
  {
    "lens": "money",
    "title": "record_accepted is not idempotent: a retried call erases the carrier_id, the DLR is then never matched and the message stays SUBMITTED for ever",
    "verdict": "confirmed",
    "severity": "medium",
    "file": "C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\gateway\\src\\gateway\\dispatch.py (line 232, with the unconditional `carrier_id = $5` at line 197)",
    "reasoning": "I could not refute it. I looked for a WHERE clause, a constraint or a second lookup path that would save it, and there is none.\n\nSequence in the current code:\n1. First record_accepted call: `owner` is None, so _close_attempt writes carrier_id c-lost on attempt 1 and the message becomes SUBMITTED. Commit.\n2. Second call for the same Claimed (what _with_retries does after an asyncpg.PostgresError / OSError raised after the commit, for example a lost COMMIT acknowledgement or a failed connection reset on pool release): `owner` is now msg.id, so line 232 passes None and line 197 runs `carrier_id = $5` = NULL on the row that owned the ID. The code only tells 'no owner' from 'some owner'; it does not tell 'this same attempt' from 'another attempt of the same message'.\n3. dlr._apply (dlr.py line 100) finds the message only through submit_attempts.carrier_id. messages.carrier_id still holds c-lost but is never used for matching. The receipt is stored PENDING, the endpoint answers 200, and a resend hits UNIQUE (carrier_id, status) and is dropped as a duplicate.\n\nReproduced twice in my private database, then the test file was deleted:\n- direct double call: attempts after call 1 = [(1, 'ACCEPTED', 'c-lost')], after call 2 = [(1, 'ACCEPTED', None)]; DLR -> 200 {'result': 'pending'}; message SUBMITTED, finalized_at None; dlr_receipts = [('c-lost', 'PENDING', None)]; ledger = [('CHARGE', 4000)].\n- through the real Dispatcher.handle() and _with_retries(), with record_accepted raising asyncpg ConnectionDoesNotExistError after its commit: 2 calls, same end state, a repeated DLR -> 'duplicate'.\n\nSeverity stays medium. No money is wrong (the carrier accepted and delivered, and the charge is kept). What is lost is the final status, the DELIVERED event and the tenant webhook, with no error anywhere, and the load script's wait for final states would not end for that message. The trigger is rare (a failure between the COMMIT and its acknowledgement). It also makes the _with_retries docstring ('Every record function is idempotent, so repeating one is safe') false, and it is not the README's admitted 'DLR never arrives' case, because here the DLR arrived and was parked.\n\nSmaller side effects of the same double call, also true: the second call returns [], so the SUBMITTED live event and metric are lost; a doubled record_retry adds 1 to ambiguous_attempts twice.",
    "fix": "In record_accepted, find out which attempt owns the ID and keep it when it is this one:\n\n    owner = await conn.fetchrow(\"SELECT message_id, attempt_no FROM submit_attempts WHERE carrier_id = $1\", carrier_id)\n    mine = owner is not None and owner[\"message_id\"] == msg.id and owner[\"attempt_no\"] == msg.attempt\n    await _close_attempt(conn, msg, result, carrier_id if owner is None or mine else None)\n\nand make _close_attempt safe by itself with `carrier_id = COALESCE($5, carrier_id)`.\n\nI checked the COALESCE change by monkeypatching _close_attempt in a test: after two record_accepted calls the DLR returns 'applied' and the message is DELIVERED, and the idempotent-carrier case still gives [(1, 'ACCEPTED', 'c-same'), (2, 'ACCEPTED', None)].\n\nAdd a regression test that calls record_accepted twice with the same Claimed and then posts the DLR. Optional: in record_retry, add the ambiguous increment only when the attempt row was still open, so a repeat does not count twice."
  },
  {
    "lens": "money",
    "title": "A late 200 from a stale attempt, recorded after the message was FAILED and refunded, leaves the refund in place and the DLR is ignored",
    "verdict": "partly",
    "severity": "low",
    "file": "C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\gateway\\src\\gateway\\dispatch.py (line 235, the result of transition() is not acted on when it is None)",
    "reasoning": "The sequence is real and I reproduced it, but it is a case of a trade-off the docs already admit, and the main fix the reviewer proposes would break more than it repairs.\n\nWhat is true (run in my private database, test file deleted):\n- claim attempt 1, expire the lease, claim attempt 2, record_failed with a 400, then record_accepted for attempt 1 with c-slow, then the DLR: changes == [], DLR -> {'result': 'ignored'}, message FAILED / INVALID_DESTINATION, attempts [(1, 'ACCEPTED', 'c-slow'), (2, 'REJECTED', None)], ledger [('CHARGE', 4000), ('REFUND', -4000)], balance back to 250000000, receipt IGNORED. assert_books_balance passes.\n- a variant that needs no 400: the stalled worker holds the last allowed attempt; the next claim is attempt max+1, which handle() fails and refunds without submitting; the late 200 gives the same end state.\n\nWhy it is smaller than claimed:\n1. README ('A refund follows a final failure even after an ambiguous attempt. The carrier may have delivered that message; we cannot prove it, so we do not charge for it') and DESIGN.md question 1 state this outcome. When the refund is written the code does exactly what is written, so the code does not contradict the docs. The task rules exclude admitted trade-offs unless the code contradicts them.\n2. The message is not unflagged. The re-claim marks attempt 1 ABANDONED and sets ambiguous_attempts = 1 (confirmed in my run), which is the flag the dashboard shows, and /internal/messages/{id} lists the ACCEPTED attempt with its carrier_id.\n3. The ledger and the balance invariant stay correct. The cost is one free SMS for the tenant, paid by the gateway, which is the doubt the README says the gateway carries.\n4. The trigger needs a worker that is stalled for longer than the 30 s lease between sending and recording, while the carrier timeout is 2 s, and then still records. A crash or three failed record attempts do not lead here, because then the 200 is never recorded.\n5. The reviewer's fix (a), FAILED -> SUBMITTED with a REFUND_REVERSAL, should not be applied. FAILED is final in the brief's state machine and in status.ALLOWED; the tenant has already received its one FAILED webhook (UNIQUE webhook_once_per_message) and may have resent the message; the re-charge can hit CHECK (balance_micros >= 0) if the tenant has spent the refund; and ledger kind is limited to CHARGE and REFUND by a CHECK.\n\nWhat is left as a real gap: when the proof arrives later (attempt ACCEPTED plus a matched DLR on a FAILED, refunded message), nothing logs or counts it, and the docs do not mention that this later proof can exist.",
    "fix": "Do not move money or status. In record_accepted, when transition() returns None, read the status. If it is FAILED, log an ERROR ('carrier accepted attempt N of message X after it was failed and refunded'), increase a new counter (for example smsgw_accept_after_failed_total), and return no changes. Add one sentence to DESIGN.md question 1 and to the README trade-off: a worker that outlives its lease can record an acceptance after the message was failed and refunded; the message stays FAILED and refunded, and the case is visible as an ACCEPTED attempt with ambiguous_attempts > 0. Add the reverse-order test next to test_a_slow_worker_that_answers_after_its_lease_still_counts, asserting FAILED, one REFUND, DLR 'ignored', and that the books balance."
  },
  {
    "lens": "money",
    "title": "The MAX_ATTEMPTS_EXCEEDED path leaves its submit_attempts row open, so a FAILED message shows an attempt in flight and the in_flight count is wrong for ever",
    "verdict": "confirmed",
    "severity": "low",
    "file": "C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\gateway\\src\\gateway\\dispatch.py (lines 405-409 call record_failed with result None; lines 276-277 then skip _close_attempt)",
    "reasoning": "I could not refute it. Nothing closes that row later: the only other code that closes an open attempt is the `closed` CTE of the claim statement, and a FAILED message is never claimed again. queries.queue_stats (queries.py line 234) counts `submit_attempts WHERE outcome IS NULL` with no join to the message status and no time limit.\n\nReproduced in my private database (test file deleted), with max_attempts = 2 and two abandoned claims: message FAILED / MAX_ATTEMPTS_EXCEEDED, attempts = 3, attempt rows [(1, 'ABANDONED', None), (2, 'ABANDONED', None), (3, None, None)], carrier.requests == [], queue_stats == {'depth': 0, 'oldest_age_ms': 0, 'in_flight': 1}, and still 1 after another dispatcher tick. The refund and the ledger are correct ([CHARGE 4000, REFUND -4000], books balance).\n\nSeverity stays low. No money and no message is affected. The effect is a permanent +1 per such message in the dashboard in-flight tile, the SSE stats and the smsgw_submits_in_flight gauge, and a FAILED message whose detail view shows an attempt with outcome null, which docs/API.md line 246 defines as 'while the attempt is in flight' and the migration comment as 'a submit may be on the wire', for a submit that was never sent. It only happens when the last allowed attempt was abandoned (a worker crash or stall on exactly that attempt), so it is rare. The same open row also appears in the second variant of finding 2.",
    "fix": "In record_failed, when `result is None`, remove the write-ahead row in the same transaction, after fail_message:\n\n    if result is None:\n        await conn.execute(\n            \"DELETE FROM submit_attempts WHERE message_id = $1 AND attempt_no = $2 AND outcome IS NULL\",\n            msg.id, msg.attempt)\n\nThis is the statement release_claim already uses. It is safe for a stale caller, because a newer claim has already set that row to ABANDONED, so `outcome IS NULL` matches nothing. I checked it with a monkeypatched record_failed: the message is FAILED and queue_stats in_flight is 0. Extend test_gives_up_after_max_attempts_and_refunds, or add a crash-loop test, to assert that a final message has no attempt row with outcome NULL. As a second guard, queue_stats can count only open attempts whose message is still QUEUED."
  },
  {
    "lens": "delivery",
    "title": "release_claim's fence is not monotonic: a stale release drives attempts below an existing attempt row, and every later claim fails with a unique violation",
    "verdict": "confirmed",
    "severity": "medium",
    "file": "gateway/src/gateway/dispatch.py:166 (release_claim), reached from Dispatcher._tick line 357",
    "reasoning": "I tried to refute it and could not. Nothing in the code or the migration prevents it: the release UPDATE (line 164-167) checks only `status='QUEUED' AND attempts=$2`, and attempts goes DOWN on every release, so the value 1 can be seen again after another worker claimed (2) and released (back to 1). The DELETE on line 174 only removes rows with `outcome IS NULL`, and the re-claim already set row 1 to ABANDONED (line 113-120), so row (M,1) stays. `submit_attempts_once UNIQUE (message_id, attempt_no)` (001_init.sql line 155) then rejects every later claim, and because _CLAIM is one statement the dispatch_cursor update rolls back too.\n\nI ran it in my private database (file deleted afterwards), three ways, all passed:\n1. Direct: claim_one(w-slow) -> expire lease -> claim_one(w-other) -> release_claim(other) -> release_claim(slow). Result: messages.attempts == 0, submit_attempts == [(1,'ABANDONED')], status QUEUED; claim_one then raised asyncpg.UniqueViolationError three times in a row. With 5 ShopFast messages queued, 20 sequential claims gave 1 success and 19 UniqueViolationError.\n2. Through Dispatcher._tick only (no direct release calls): worker 1 with limiter.acquire that waits on an Event then raises ConnectionError, lease expired, worker 2 whose acquire raises at once, then the Event set. Result: attempts == 0, and a healthy dispatcher's run_once() raised UniqueViolationError 5 times, carrier.requests == [], message still QUEUED.\n3. Control: the same sequence WITHOUT the stale release ends normally (SUBMITTED, attempts [(1,'ABANDONED'),(2,'ACCEPTED')]), so the stale release is the cause.\n\nWhat is smaller than the title says: (a) the trigger is narrow. It needs one worker blocked in _wait_for_token for longer than the 30 s lease and then an exception there, while a second worker claims and releases the same message in between. In practice that is a Valkey failure seen differently by the two dispatchers (one hangs on a dead socket, the other gets fast errors). I checked the client: redis 8.2.0, `aioredis.from_url(settings.redis_url)` in runner.py line 47 gives socket_timeout=None and socket_connect_timeout=None, so an indefinite hang is possible. If both workers hang, or both fail fast, nothing goes wrong (each holds a different message). (b) With two workers dispatch is not at absolute zero: when two claims overlap, SKIP LOCKED on dispatch_cursor lets the second one serve another tenant. With one worker, or non-overlapping ticks, it is zero after the first success.\n\nSeverity stays medium: no message or money is lost or duplicated, but once it happens it never heals by itself (manual SQL needed), it blocks the affected tenant completely and nearly all dispatch for everyone, and the docstring on lines 158-159 ('cannot touch a message that another worker has claimed since') is false. It is an edge case with a heavy result, not a silent loss.",
    "fix": "Make the release prove that nobody claimed since, by requiring that this worker's own attempt row is still open (a re-claim always closes it). I ran this version against the same sequence: the stale release returned no row, attempts stayed 1, and the message was then submitted normally with attempts [(1,'ABANDONED'),(2,'ACCEPTED')]; a normal own-claim release still works (attempts 0, no attempt row).\n\n    UPDATE messages m\n    SET attempts = attempts - 1, next_attempt_at = now(), locked_by = NULL\n    WHERE m.id = $1 AND m.status = 'QUEUED' AND m.attempts = $2\n      AND EXISTS (SELECT 1 FROM submit_attempts a\n                  WHERE a.message_id = m.id AND a.attempt_no = $2\n                    AND a.outcome IS NULL AND a.worker_id = $3)\n    RETURNING true\n\nPass the worker id into release_claim (add worker_id to Claimed or as a parameter) and correct the docstring. Two cheap additions that remove the trigger itself: create the Redis client with socket_timeout and socket_connect_timeout (for example 2 s) in runner.py, and in _tick measure the time since the claim after _wait_for_token returns: if it is close to lease_seconds, release instead of sending (this also stops a stale worker from submitting attempt 1 after another worker took over). Add the direct sequence above as a regression test in test_dispatch.py."
  },
  {
    "lens": "delivery",
    "title": "A callback URL that passes validation but httpx refuses is retried every 30 s forever: never DEAD, no backoff, no error recorded",
    "verdict": "confirmed",
    "severity": "medium",
    "file": "gateway/src/gateway/webhooks.py:203 (except httpx.HTTPError) and :41-45 (is_valid_callback_url)",
    "reasoning": "Could not refute. WebhookIn.callback_url is a plain `str | None` (models.py line 32), and put_webhook (api/tenant.py line 165) relies only on is_valid_callback_url, which checks the scheme and that urlsplit finds a hostname. In httpx 0.28.1 `httpx.InvalidURL.__mro__` is (InvalidURL, Exception, ...): not an HTTPError, so line 203 does not catch it. The exception leaves _deliver before either UPDATE, _deliver_safely only logs, and the claim had already added 1 to attempts and pushed next_attempt_at by the lease.\n\nRan in my private database (file deleted afterwards), all passed:\n- For each of 'https://acme.example:8O80/hooks/sms', 'https://tenant.example/hook\\n', 'http://example.com/\\x01', 'http://exämple..com/hook': PUT /v1/webhook returned 200; after a message reached DELIVERED, 10 rounds of worker.run_once() with webhook_max_attempts=3 left the row at status PENDING, attempts 10, last_error NULL, and the endpoint transport was called 0 times.\n- After one failed round, next_attempt_at - now() was 29.998 s: the retry interval is the fixed lease, not backoff_seconds().\n- After the tenant corrected the URL, a new message was delivered (1 call) but the old row kept the broken URL and stayed PENDING (the URL is copied into the row in lifecycle.enqueue_webhook).\n- Extra, same root cause: PUT /v1/webhook with 'http://[::1/hook' raised ValueError('Invalid IPv6 URL') out of the app, because urlsplit raises inside the validator. In production that is an HTTP 500 for bad input instead of the 422 the API promises.\n\nI grade it medium, not low. The trailing-newline case is an ordinary tenant mistake, not an attack, and the result is permanent and unbounded: for that class of URL the requirement 'Retry a failed callback with backoff' and the documented max attempts are both not applied, the dashboard shows PENDING with no error for ever, and every such row costs one UPDATE and one logged stack trace every 30 s without end (a 10,000-message campaign gives about 330 per second). What limits it: no message or money is affected, other tenants' callbacks and the dispatcher are not slowed (the failing tasks finish at once and free their slots), and new rows of the same tenant still go out.",
    "fix": "In WebhookWorker._deliver, treat any failure of the request as a failed attempt so it is recorded, backed off and ends in DEAD:\n\n    try:\n        response = await self._client.post(row[\"url\"], content=body, headers=headers)\n        ...\n    except (httpx.HTTPError, httpx.InvalidURL, ValueError, UnicodeError) as exc:\n        error = f\"{type(exc).__name__}: {exc}\"[:500]\n\nAnd make the validator agree with the client that will use the URL, so the bad value is refused at PUT time with a 422:\n\n    def is_valid_callback_url(url: str) -> bool:\n        if len(url) > MAX_URL_LENGTH or url != url.strip() or any(ord(c) < 0x21 or ord(c) == 0x7f for c in url):\n            return False\n        try:\n            parts = urlsplit(url)\n            parts.port                      # raises ValueError on a bad port\n            httpx.URL(url)                  # raises InvalidURL on what httpx refuses\n        except (ValueError, httpx.InvalidURL):\n            return False\n        return parts.scheme in (\"http\", \"https\") and bool(parts.hostname)\n\nAdd one test per layer: PUT with 'https://x.example:8O80/h', 'https://x.example/h\\n' and 'http://[::1/h' returns 422; a delivery row that already holds such a URL reaches DEAD after webhook_max_attempts with last_error set."
  },
  {
    "lens": "delivery",
    "title": "A 429 answer is not recorded when the limiter penalty call fails: the message is hidden for the full lease and then flagged as an ambiguous attempt",
    "verdict": "confirmed",
    "severity": "low",
    "file": "gateway/src/gateway/dispatch.py:418-420 (penalize before the record_* call in Dispatcher.handle)",
    "reasoning": "Could not refute. In handle(), `await self._limiter.penalize(...)` on line 420 runs before decide() and before any record_* call and has no try/except; _handle_safely (line 395-401) only logs. Nothing else between the carrier response and the record can raise, so this is the one gap.\n\nRan in my private database (file deleted afterwards), passed: one message, carrier scripted 429 then accept, dispatcher._limiter.penalize replaced by a function that raises ConnectionError. After run_once(): submit_attempts == [(1, None)] (the 429 was not recorded) and next_attempt_at - now() == 29.99 s instead of the 0.25-0.5 s backoff. After expiring the lease and running a healthy dispatcher: status SUBMITTED, attempts 2, ambiguous_attempts 1, submit_attempts == [(1,'ABANDONED'),(2,'ACCEPTED')]. Control without the failing penalize: [(1,'RATE_LIMITED')], ambiguous_attempts 0.\n\nSo a submit the carrier definitely refused is stored and shown as 'the carrier may have accepted this more than once', against the meaning of ambiguous_attempts in 001_init.sql lines 80-81. Severity low is right: the window is tiny (Valkey must fail between granting the token and the 429 answer, and 429s are rare by design with the 0.92 headroom), the error is in the cautious direction (over-flagging, never under-flagging), and nothing is lost or charged wrongly: one attempt of six and 30 s are spent. Note that with the current client (no socket timeout, see finding 1) a hanging Valkey would make penalize block instead of raise, which holds one of the 32 in-flight slots until the connection dies; the same fix plus a socket timeout covers that.",
    "fix": "The penalty is best effort; the record is not. Do not let the first block the second:\n\n    if result.outcome is Outcome.RATE_LIMITED:\n        try:\n            await self._limiter.penalize(settings.carrier_429_penalty_seconds)\n        except Exception:\n            log.warning(\"could not apply the 429 penalty\", exc_info=True)\n\n(or move the penalize call to after the record_* call, still inside a try/except). Add socket_timeout to the Redis client in runner.py so the call cannot hang. Regression test: the scenario above must end with submit_attempts == [(1,'RATE_LIMITED'),(2,'ACCEPTED')] and ambiguous_attempts == 0."
  },
  {
    "lens": "fairness",
    "title": "The claim statement's cost grows with the size of the campaign, not with the number of tenants as DESIGN.md says; at a 300,000-message campaign two dispatchers send 29/s instead of 46/s",
    "verdict": "partly",
    "severity": "medium",
    "file": "gateway/src/gateway/dispatch.py:89 (also gateway/src/gateway/queries.py:235, DESIGN.md:107, gateway/migrations/001_init.sql:99)",
    "reasoning": "Reproduced on PostgreSQL 16.14 in my own database, but the scope is narrower than claimed and the plan is not the single shape the reviewer reports.\n\nWhat is true:\n1. At 300,000 rows, analysed while all QUEUED, then half sent: claim 31.6 ms, two real Dispatcher.run() loops (limit 50, headroom 0.92, burst 2, 5 s) sent 30.2/s against a 46.0 target. Same result as the reviewer (28.9/s).\n2. Three plan shapes appear, depending on statistics: (a) next_tenant as HashAggregate over a Seq Scan of every QUEUED row; (b) picked as Index Scan on messages_pkey with a filter, which walks every already-sent row (\"Rows Removed by Filter: 149999\"); (c) messages_dispatch_idx for both, about 0.3-1 ms. The same table gave 0.73 ms before ANALYZE and 61 ms after it (300,000 all QUEUED).\n3. Inside what the seeded balance can buy (ShopFast 1,000 USD: 250,000 messages at +880, 285,714 at +63, no top-up endpoint), with statistics from when the campaign was all QUEUED: 150,000 rows 8.5 / 15.9 / 24.2 ms at 25 / 50 / 75% sent; 200,000 rows 12.1 / 23.4 / 55.3 ms; 250,000 rows 13.5 / 26.3 / 39.7 ms. A fresh ANALYZE brought it back to about 1 ms in 11 of 12 cases (200,000 at 75% sent stayed at 26 ms).\n4. The DESIGN.md sentence \"The claim probes each tenant once\" is false even in the required run: at 10,000 QUEUED the plan is HashAggregate over Seq Scan (actual rows=10000), 2.2-2.9 ms per claim. No visible effect there: 46.6/s.\n5. queue_stats: 108 ms at 300,000 half sent, of which the depth count(*) alone is 31 ms. The count is already admitted in DESIGN.md section 4 item 4; the rest contradicts the comment at queries.py:235.\n\nWhat is not true:\n- The cost is not linear in \"messages already sent\" in general. With 290,000 sent messages of history and one 10,000 campaign (the case the brief describes) the claim cost 0.3-3.6 ms in all five statistics states and throughput was 46.6/s. The slowdown needs one backlog of roughly 100,000 or more that is a large share of the whole table, plus lagging statistics or an unlucky plan.\n- \"plan in every row: picked -> messages_pkey\" is not stable; see point 2.\n- The 300,000 headline case cannot be bought with the seeded ShopFast balance. The effect is still real at 150,000-250,000.\n\nNo message or money is affected; messages are only sent more slowly. Medium stands because a DESIGN.md statement and two code comments are contradicted by the plans, and the gateway becomes the bottleneck in a reachable edge case.",
    "fix": "Apply the reviewer's rewrite of next_tenant and picked in _CLAIM (LATERAL ... LIMIT 1 instead of EXISTS, and the range form `m.tenant_id >= X AND m.tenant_id <= X` with `ORDER BY m.tenant_id, m.id`, so only messages_dispatch_idx can supply the order). I checked it: 0.26-2.1 ms per claim in every state above (10,000 to 300,000, stale and fresh statistics), and all 18 tests in tests/test_dispatch.py pass with dispatch._CLAIM replaced by it (alternation, 50 tenants, no double claim, lease recovery, deadlock test). Add a comment in the SQL saying why the range form is there, because it looks redundant. Use the same form in the LATERAL of queries.queue_stats. Change DESIGN.md line 107-108 to say what is now true (\"one index probe per tenant\"), and add a test that loads about 50,000 QUEUED rows, runs ANALYZE, marks half DELIVERED and asserts that EXPLAIN of the claim contains neither \"Seq Scan on messages\" nor \"messages_pkey on messages m_1\"."
  },
  {
    "lens": "fairness",
    "title": "The load script's verdict on the carrier limit cannot fail: the carrier's peak statistic is capped at the limit, and Result: PASS ignores 429s",
    "verdict": "partly",
    "severity": "low",
    "file": "loadtest/load_test.py:805 (and mock-carrier/src/mock_carrier/submit.py:48)",
    "reasoning": "The first half is confirmed, the second half is documented behaviour.\n\nConfirmed: SlidingWindow.try_admit (mock-carrier/src/mock_carrier/rate_limit.py:24) refuses once the window holds `limit` entries, and submit.py:48 records len(window) only after an admit, so max_submits_in_one_second can never be above RATE_LIMIT_PER_SEC. My run: 500 submits in one burst against a carrier with limit 50 printed \"rate_limited (429) 450\" and, on the next line, \"max_submits_in_one_second 50 (stayed within the limit of 50)\". So in the documented setup (carrier limit 50, script constant 50) the verdict text is always \"stayed within\", and loadtest/README.md:144 (\"the busiest second\") describes the statistic wrongly: it is the busiest second of admitted submits.\n\nNot as claimed:\n- \"the else branch is unreachable\" holds only when the carrier limit is 50 or lower. With RATE_LIMIT_PER_SEC=60 the same burst printed \"60 (WENT ABOVE the limit of 50)\".\n- \"Result: PASS ignores 429s\" is not a contradiction. loadtest/README.md:57 says exit code 0 means the billing check passes, and line 187 says the last line is \"Result: PASS or Result: FAIL (billing check)\". The brief asks the script to print numbers, not a verdict on the limit.\n- The overshoot is not hidden: the 429 count is printed on the line directly above, and README.md:142 says \"Zero means the gateway's pacing never overshot\". In the published run it is 0 with a peak of 48, so the README's result is not affected.\n\nWhat remains is one misleading phrase in the report and one imprecise sentence in the load test README. Low.",
    "fix": "Smallest correct change, in load_test.py only: `verdict = \"stayed within\" if stats[\"rate_limited\"] == 0 and peak <= CARRIER_LIMIT_PER_SECOND else \"WENT ABOVE\"`. Change loadtest/README.md lines 144-145 to: \"the largest number of submits the carrier admitted in any one second; it cannot be above the carrier's own limit, so the line also looks at rate_limited\". I would not change the carrier statistic or its test (test_submit.py:131 asserts the current meaning on purpose), and I would leave Result and the exit code tied to the billing check as documented. Optional: add a WARNING line when rate_limited > 0."
  },
  {
    "lens": "fairness",
    "title": "A 429 is not recorded if Valkey fails during the penalty call: the message is hidden for the full 30 s lease and then flagged as possibly delivered",
    "verdict": "confirmed",
    "severity": "low",
    "file": "gateway/src/gateway/dispatch.py:420",
    "reasoning": "Reproduced exactly. dispatch.py:420 awaits self._limiter.penalize() before decide() and record_retry(); nothing catches an error from it except _handle_safely (line 398), which only logs.\n\nMy run, with the carrier scripted to answer 429 and penalize raising ConnectionError:\n- after the tick: status QUEUED, attempts 1, ambiguous_attempts 0, next_attempt_at 30 s ahead, submit_attempts [(1, None)]. The 429 was never written.\n- after the lease passed: status SUBMITTED, attempts 2, ambiguous_attempts 1, attempts [(1, 'ABANDONED'), (2, 'ACCEPTED')].\n\nSo a result the gateway knew for certain (not accepted) becomes \"the carrier may have this twice\", and the message waits 30 s instead of the backoff. No line prevents it.\n\nSeverity stays low: it needs a 429 (0 in the published run) on a submit already in flight at the moment Valkey becomes unreachable. No message or money is lost, and the message is sent once.",
    "fix": "Do not let the limiter decide whether a known result is recorded. In handle():\n\n    if result.outcome is Outcome.RATE_LIMITED:\n        try:\n            await self._limiter.penalize(settings.carrier_429_penalty_seconds)\n        except Exception:\n            log.warning(\"could not apply the 429 penalty\", exc_info=True)\n\nAdd a test with the scenario above that asserts attempt 1 has outcome RATE_LIMITED, ambiguous_attempts stays 0 and the message is visible again after its backoff, not after the lease."
  },
  {
    "lens": "fairness",
    "title": "The MAX_ATTEMPTS_EXCEEDED path leaves its attempt row open forever, so the in-flight count never returns to zero and an unsent attempt is charted as a submit",
    "verdict": "confirmed",
    "severity": "low",
    "file": "gateway/src/gateway/dispatch.py:405 (record_failed, line 276)",
    "reasoning": "Reproduced. handle() at line 405 calls record_failed(msg, None, decision); record_failed closes the attempt only `if result is not None` (line 276), and nothing else ever touches the row because a FAILED message is never claimed again (the `closed` CTE only runs for a picked QUEUED message).\n\nMy run with max_attempts=2 and two dead workers: status FAILED, attempts 3, submit_attempts [(1, 'ABANDONED'), (2, 'ABANDONED'), (3, None)], carrier requests 0, queue_stats in_flight 1, permanently.\n\nIt is easier to reach than the reviewer's scenario says. It does not need max_attempts crashes in a row, only that the last allowed attempt goes unrecorded. With max_attempts=3: two recorded 503s, then the worker of attempt 3 dies; the next claim gave FAILED, attempts 4, [(1, 'UNAVAILABLE'), (2, 'UNAVAILABLE'), (3, 'ABANDONED'), (4, None)], and in_flight stayed one higher. The message also shows attempts = max_attempts + 1 although only max_attempts submits were made.\n\nThe status, the refund and the ledger are correct (balance back to 250,000,000). The effect is a wrong in-flight number on the dashboard and the IN_FLIGHT gauge, a last attempt that looks in progress on the detail screen, and one extra count in queries.throughput (it counts every submit_attempts row by started_at). Low.",
    "fix": "In record_failed, after fail_message applied and when result is None, undo the claim's bookkeeping in the same transaction, as release_claim does:\n\n    if change is not None and result is None:\n        await conn.execute(\n            \"DELETE FROM submit_attempts WHERE message_id = $1 AND attempt_no = $2 AND outcome IS NULL\",\n            msg.id, msg.attempt)\n        await conn.execute(\"UPDATE messages SET attempts = attempts - 1 WHERE id = $1\", msg.id)\n\nIt must come after fail_message, because the transition is fenced on attempts = msg.attempt. I ran this: the result was FAILED, attempts 2, [(1, 'ABANDONED'), (2, 'ABANDONED')], in_flight 0, refund intact. Add a crash-loop test that asserts no attempt of a FAILED message has outcome NULL and that queue_stats reports in_flight 0."
  },
  {
    "lens": "api",
    "title": "A callback URL that the API accepts but httpx refuses is retried forever: never DEAD, no error recorded",
    "verdict": "confirmed",
    "severity": "medium",
    "file": "C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\gateway\\src\\gateway\\webhooks.py:203 (and :41-45, :177-182)",
    "reasoning": "I could not refute it. Re-ran it on the private database (test file deleted afterwards).\n\nSequence that really happens:\n1. PUT /v1/webhook {\"callback_url\": \"http://example.com/hook\\n\"} -> 200, stored unchanged. is_valid_callback_url (webhooks.py:41-45) uses urlsplit, which strips the newline before parsing, so scheme/hostname look fine. \"http://[v1.x]/\" passes the same way.\n2. A message goes FAILED (carrier 400) -> lifecycle.enqueue_webhook copies that URL into webhook_deliveries.\n3. WebhookWorker claims the row (attempts+1, lease), self._client.post() raises httpx.InvalidURL while building the request. Checked in this environment (Python 3.11.9, httpx 0.28.1): isinstance(InvalidURL(), httpx.HTTPError) is False, so line 203 does not catch it. _deliver_safely (line 180) only logs. No UPDATE runs.\n4. After 20 rounds with webhook_max_attempts=6: {'status': 'PENDING', 'attempts': 20, 'last_error': None}, 0 calls to the endpoint. Same for \"http://[v1.x]/\".\n\nNothing in the migration prevents it: tenants.callback_url and webhook_deliveries.url are plain text with no CHECK, and there is no cap on attempts in the claim SQL.\n\nWhat is narrower than it may sound: only URLs that make httpx raise InvalidURL are affected (tab/CR/LF anywhere in the URL, a malformed bracketed host). I also tried \"http://example.com:99999/hook\", a space in the host and a space in the path: those do not get stuck (a bad port gives httpx.ConnectTimeout with the real transport, which is an HTTPError and takes the normal retry/DEAD path). Other tenants are not starved, because slots are per tenant. The \"about 330 claims per second\" figure for 10,000 rows is right as an average (10,000 rows / 30 s lease). It is the tenant's own bad input, and only that tenant's callbacks are lost, so medium is the right grade: a row that is stuck forever and contradicts the documented PENDING -> DEAD.",
    "fix": "Two changes in gateway/src/gateway/webhooks.py:\n1. _deliver, line 203: `except Exception as exc: error = f\"{type(exc).__name__}: {exc}\"[:500]` (CancelledError is a BaseException, so shutdown still works). Every failed send then goes through the existing backoff and DEAD update.\n2. is_valid_callback_url: refuse anything httpx cannot request:\n   if len(url) > MAX_URL_LENGTH or not url.isascii() or any(c.isspace() or not c.isprintable() for c in url): return False\n   try: parts = urlsplit(url); host = parts.hostname; httpx.URL(url)\n   except (ValueError, httpx.InvalidURL): return False\n   return parts.scheme in (\"http\", \"https\") and bool(host)\nAdd one test per case (newline URL -> 422; a delivery whose POST raises a non-HTTPError ends DEAD after webhook_max_attempts)."
  },
  {
    "lens": "api",
    "title": "Tenant read endpoints answer 500 (plain text, not the documented error envelope) for hostile query values and forged cursors",
    "verdict": "confirmed",
    "severity": "medium",
    "file": "C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\gateway\\src\\gateway\\queries.py:33 (also :75-79, :91, :161; api/tenant.py:30-34, :100-102; errors.py:73-88)",
    "reasoning": "I could not refute it. Re-ran all seven cases through httpx.ASGITransport(raise_app_exceptions=False) with a valid X-API-Key; each returned `500 'Internal Server Error'` (plain text):\n- /v1/messages?client_ref=a%00b\n- /v1/messages?created_from=0001-01-01T00:00:00+14:00\n- /v1/messages?created_to=9999-12-31T23:59:59-12:00\n- /v1/messages?cursor=<b64 of [\"0001-01-01T00:00:00+14:00\", uuid]>\n- /v1/messages?cursor=<b64 of 3000 \"[\">\n- /v1/ledger?cursor=<b64 of [\"99999999999999999999999999\"]>\n- /v1/ledger?cursor=<b64 of 3000 \"[\">\n/internal/messages?q=a%00 and ?created_from=0001-01-01T00:00:00+14:00 give 500 too.\n\nControls I added to check the reviewer did not just hit a broken setup: cursor=garbage, created_from=nonsense and a ledger cursor of [\"abc\"] all return the proper 422 envelope. So the existing handlers work and these inputs fall through them: decode_cursor (queries.py:33) catches only ValueError/UnicodeError, list_messages (line 93) and list_ledger (line 162) catch only ValueError, as_utc (tenant.py:30) never converts to UTC, client_ref on the GET has no check at all (the POST side does check it with validation._is_storable), and install_error_handlers (errors.py) has no catch-all.\n\nImpact is exactly as stated and no more: no data is lost, changed or leaked, and the request must carry a valid API key. It contradicts docs/API.md line 19 (\"Errors always have this shape\"). That is wrong behaviour in an edge case plus a false sentence in the docs, so medium by the scale given, at the low end of it.",
    "fix": "1. gateway/src/gateway/queries.py decode_cursor: reject `len(cursor) > 256` first, and catch `(ValueError, UnicodeError, RecursionError)`.\n2. list_messages cursor branch: `datetime.fromisoformat(created_at).astimezone(UTC)` inside the existing try, and catch `(ValueError, OverflowError)`.\n3. list_ledger: after int(), `if not 0 <= after_id < 2**63: raise ValueError` inside the existing try.\n4. gateway/src/gateway/api/tenant.py as_utc(value, field): for an aware value return `value.astimezone(UTC)` inside try/except OverflowError -> validation_error([{field, INVALID_VALUE, \"Out of range.\"}]). Call it with the field name from both list endpoints.\n5. client_ref on GET /v1/messages: `Annotated[str | None, Query(min_length=1, max_length=64)]` and a 422 if `\"\\x00\" in client_ref`; same NUL check for `q` on /internal/messages.\n6. gateway/src/gateway/errors.py: add `@app.exception_handler(Exception)` returning `{\"error\": {\"code\": \"INTERNAL_ERROR\", \"message\": \"Internal error.\"}}` with status 500 (and log the exception), and add INTERNAL_ERROR to the table in docs/API.md, so the envelope sentence is true on every path."
  },
  {
    "lens": "api",
    "title": "PUT /v1/webhook answers 500 for three kinds of malformed URL",
    "verdict": "confirmed",
    "severity": "low",
    "file": "C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\gateway\\src\\gateway\\webhooks.py:44 (and api/tenant.py:165-169)",
    "reasoning": "I could not refute it. Re-ran the three bodies with a valid X-API-Key:\n- {\"callback_url\": \"http://[::1\"} -> 500 (urlsplit raises ValueError inside is_valid_callback_url, no try/except at line 44)\n- {\"callback_url\": \"http://example.com/\\u0000\"} -> 500 (passes the check, the UPDATE at tenant.py:169 fails in asyncpg)\n- {\"callback_url\": \"http://example.com/\\ud800\"} -> 500 (lone surrogate reaches asyncpg; Pydantic's plain `str` does not stop it)\nIn all three the stored callback_url stayed NULL, so nothing is written and nothing is lost. I checked WebhookIn (models.py): `callback_url: str | None` with no validator, so nothing earlier in the request path rejects these.\n\nIt is the same root cause as the stuck-delivery finding (the URL check is only scheme + hostname) and the same class as the read-endpoint 500s. On its own it is a 500 instead of a 422 on input no real client sends; low is right. It should be fixed together with finding 1, not counted as a separate problem.",
    "fix": "The same rewrite of is_valid_callback_url as in finding 1 covers all three: return False unless the string is ASCII with no whitespace and no non-printable character (this removes NUL, surrogates, tabs, newlines), and wrap `urlsplit(url)`, `parts.hostname` and `httpx.URL(url)` in `try/except (ValueError, httpx.InvalidURL): return False`. Add a parametrized test that each of the three bodies returns 422 VALIDATION_ERROR with field callback_url."
  },
  {
    "lens": "api",
    "title": "A stalled Valkey makes POST /v1/messages hang after the charge and the message are already committed",
    "verdict": "confirmed",
    "severity": "medium",
    "file": "C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\gateway\\src\\gateway\\live.py:32 (client built at api/app.py:44 and runner.py:47; awaited at api/tenant.py:66, :91, api/internal.py:157, api/carrier_callbacks.py:43)",
    "reasoning": "I tried to refute it by replacing the reviewer's stub with the real client, because a stub whose publish never returns proves nothing about redis-py. It still holds.\n\nTest: an asyncio TCP server on a free 127.0.0.1 port that accepts connections and never answers (what a `docker pause`d or blocked Valkey looks like), and `aioredis.from_url(settings.redis_url, decode_responses=True)`, the exact call at api/app.py:44, passed to create_app. Result with redis-py 8.2.0:\n  socket_timeout: None  socket_connect_timeout: None\n  answered within 4s: False   messages: 1   balance: 249996000 (250,000,000 - 4,000)\nSo the accept transaction committed (message row, charge) and the 202 was never sent. LivePublisher.publish's `except Exception` (live.py:33) cannot help because nothing is raised.\n\nWhat is true and what is not:\n- Valkey DOWN (connection refused, DNS failure) is handled: it raises, is logged and ignored. Only a server that holds the connection open without answering hangs the request.\n- A retry WITH the same Idempotency-Key is safe: accept_messages returns replayed=True and the route skips the publish (tenant.py:64), so the client gets its 202. Only a client without a key creates a second message and a second charge when it retries, and that is the documented behaviour for any lost response, so I would not call this a money bug.\n- POST /carrier/dlr hangs the same way after the DLR is committed; the carrier's resend is then a duplicate with no changes, which returns 200 without publishing. No receipt is lost.\n- /readyz also hangs on redis.ping(), so the compose healthcheck (timeout 2 s) marks the container unhealthy, but nothing restarts or reroutes on that.\n\nIt contradicts live.py's own docstring (\"a failure to publish is logged and ignored\", \"the stream must never break a request or a worker\") and DESIGN.md (\"Valkey holds only what may be lost\"): the send API's availability depends on Valkey answering. No message or money is lost or created by the gateway itself, so medium, not high.",
    "fix": "1. gateway/src/gateway/live.py, LivePublisher.publish:\n   await asyncio.wait_for(self._redis.publish(self._channel, json.dumps(...)), timeout=0.25)\n   (asyncio.TimeoutError is the builtin TimeoutError on 3.11+, already swallowed by the existing `except Exception`).\n2. gateway/src/gateway/api/app.py:44 and runner.py:47: `aioredis.from_url(settings.redis_url, decode_responses=True, socket_timeout=1.0, socket_connect_timeout=1.0)`. Keep the pub/sub subscription in LiveHub on a client without socket_timeout (or it will time out while idle), i.e. a second client for the hub.\n3. Add a test with a publish that never returns: POST /v1/messages must answer 202 in under a second. A further step, not required: publish from a bounded in-process queue drained by a background task so the request path never awaits Valkey at all."
  },
  {
    "lens": "api",
    "title": "GET /metrics is public on the tenant API port and reports message counts per tenant slug",
    "verdict": "confirmed",
    "severity": "low",
    "file": "C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\gateway\\src\\gateway\\api\\app.py:84 (label set at api/tenant.py:65, :90, api/internal.py:156; metrics.py:8)",
    "reasoning": "The facts are right and I found nothing that prevents it. GET /metrics with no X-API-Key and no X-Admin-Token returned 200 and the lines `smsgw_messages_accepted_total{tenant=\"acme-bank\"} ...` and `smsgw_messages_accepted_total{tenant=\"shopfast\"} 1.0` after one ShopFast send. The route at app.py:84 has no dependency, the counter is labelled with tenant.slug, and docker-compose.yml publishes 8000:8000, the same port the tenant API uses.\n\nWhat it is and is not: an unauthenticated caller (or the other tenant) learns the other customers' slugs and how many messages each API process accepted since it started, plus global queue depth, submit outcomes and DLR counts. No message content, number, balance or ledger row. The assignment's isolation rule names messages, event history, balance and ledger, none of which are exposed, so this is not a break of that stated requirement; it is a small information leak next to it. It is not covered by README \"Not done\" (that list mentions only the dashboard having no login and metrics being per process) and the same per-tenant numbers on /internal/tenants are behind the admin token, so the code is inconsistent with its own guard. Low is the right grade.",
    "fix": "In gateway/src/gateway/api/app.py: `@app.get(\"/metrics\", tags=[\"ops\"], dependencies=[Depends(require_admin)])` (import Depends and require_admin from gateway.api.deps), and note in README/API.md that a scraper sends X-Admin-Token. If an open scrape endpoint is wanted, drop the `tenant` label from smsgw_messages_accepted_total instead; the queue and outcome metrics carry nothing tenant-specific."
  },
  {
    "lens": "api",
    "title": "A correctly signed DLR can still crash the endpoint with 500 instead of the documented 422",
    "verdict": "confirmed",
    "severity": "low",
    "file": "C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\gateway\\src\\gateway\\api\\carrier_callbacks.py:52 (also :63-67, :82)",
    "reasoning": "I could not refute it. Re-ran the three bodies, each signed with the test DLR_SECRET:\n- carrier_id \"c\\ud800\" -> 500 (_parse checks only type, length and NUL at lines 63-67; asyncpg cannot encode the lone surrogate)\n- timestamp \"0001-01-01T00:00:00+14:00\" -> 500 (fromisoformat accepts it at line 82; asyncpg overflows converting it to UTC for the timestamptz parameter in dlr.ingest)\n- 100,000 \"[\" -> 500 (json.loads raises RecursionError; line 52 catches only ValueError)\nA control body with a bad status and timestamp returned the proper 422, and in all cases dlr_receipts stayed empty (the INSERT is inside a transaction that rolls back), so nothing is stored and no status changes.\n\nLimits on the claim: only someone holding DLR_SECRET can send these, so it is not an attack path, and no real carrier sends such a body. The \"carrier may redeliver for ever\" consequence is speculation about a carrier, not something in this code. What is true is the mismatch with docs/API.md (\"422: Signature is right but the body is not a valid DLR\"). Low.",
    "fix": "In gateway/src/gateway/api/carrier_callbacks.py _parse:\n- line 52: `except (ValueError, RecursionError) as exc:`\n- carrier_id: replace the `\"\\x00\" in carrier_id` test with `not validation._is_storable(carrier_id)` (import from gateway.validation; it covers NUL and unpaired surrogates).\n- timestamp: after fromisoformat, `timestamp = (timestamp if timestamp.tzinfo else timestamp.replace(tzinfo=UTC)).astimezone(UTC)` inside `try/except (ValueError, OverflowError): timestamp = None`, so an out-of-range time is reported as the existing timestamp INVALID_VALUE detail.\nThe catch-all exception handler proposed for the read endpoints also guarantees the JSON envelope here."
  },
  {
    "lens": "spec",
    "title": "AI transcript is not in the repository, but README says it is",
    "verdict": "confirmed",
    "severity": "high",
    "file": "README.md",
    "reasoning": "Could not refute. `ls docs/ai-transcript` shows only README.md, and that file (lines 6-8) says the export \"belongs in this folder. It is added by hand\". The top-level README (now lines 252-254, not 235 as cited) still states \"The session transcript is in docs/ai-transcript\". .gitignore does not hide anything there, so nothing is waiting untracked. The brief makes the transcript mandatory when AI tools are used (assignment lines 119 and 140). Caveat: this is a deliberate pending manual step, not a code bug, and a complete export can only be made once the building session has ended. As the repository stands, a grader finds a required item missing and a README sentence that is false, so high is the right grade for a submission blocker.",
    "fix": "Before submitting: export every session used, remove personal paths and details, and put the files into docs/ai-transcript/. Until that is done, change README.md:253-254 to say the transcript is added at submission, so the README does not claim something that is not there. Add this to the final pre-submit checklist next to the LOAD_OUTPUT marker and the screenshots."
  },
  {
    "lens": "spec",
    "title": "A callback URL that httpx refuses is accepted, then its webhooks retry forever (never DEAD, no error recorded); one malformed URL returns HTTP 500",
    "verdict": "confirmed",
    "severity": "medium",
    "file": "gateway/src/gateway/webhooks.py",
    "reasoning": "Reproduced on the private database with the current code (webhooks.py unchanged since 23:32). PUT /v1/webhook with \"http://example.com:abc/hook\" and with \"http://a\\nb/hook\" both return 200, because is_valid_callback_url (webhooks.py:41-45) checks only scheme and hostname. After one message went FAILED, ten WebhookWorker.run_once() calls with webhook_lease_seconds=0 left the row at {'status': 'PENDING', 'attempts': 10, 'last_error': None, 'last_http_status': None} with webhook_max_attempts = 6 and zero requests reaching the transport. Cause confirmed: httpx.InvalidURL's MRO is (InvalidURL, Exception), so `except httpx.HTTPError` at webhooks.py:203 misses it; _deliver_safely (177-182) only logs. The 500 is also real: is_valid_callback_url(\"http://[::1/hook\") raises ValueError(\"Invalid IPv6 URL\") and errors.py has no generic handler, so the PUT raises out of the app. Scope check: I looked for other URLs that pass validation and break delivery; an out-of-range port (127.0.0.1:99999) gives ConnectTimeout, which is an HTTPError and takes the normal path to DEAD, so the hole is only InvalidURL. Other tenants and sending are not affected (own process, per-tenant slots), and the tenant has to store a malformed URL first, so medium is right: it breaks the documented give-up rule and gives the tenant no error, but loses no message or money.",
    "fix": "1) webhooks.py is_valid_callback_url: wrap the parse and also build the URL the way the worker will: `try: parts = urlsplit(url); httpx.URL(url)` / `except (ValueError, httpx.InvalidURL): return False`. That turns all three inputs into a 422. 2) webhooks.py:203: catch `(httpx.HTTPError, httpx.InvalidURL)` and set `error`, so a bad row already in the table goes through backoff and ends DEAD after webhook_max_attempts with last_error filled. 3) Add both cases to test_webhooks.py (PUT returns 422; a stored bad URL ends DEAD with attempts == 6)."
  },
  {
    "lens": "spec",
    "title": "A lost DLR leaves a message in SUBMITTED forever; DESIGN.md says it \"reaches one final status\"",
    "verdict": "partly",
    "severity": "low",
    "file": "DESIGN.md",
    "reasoning": "The behaviour is real, but the main complaint is out of date. Real: status.ALLOWED lets a message leave SUBMITTED only by a DLR, finalize_from_dlr has one caller (dlr.py:108), and no query in src/gateway selects SUBMITTED rows by age. My test submitted a message, back-dated submitted_at by 30 days, ran the dispatcher and the webhook worker again, and the row stayed SUBMITTED with finalized_at NULL. The mock gives up after four tries, about 1.7 s of backoff (mock-carrier dlr.py:23, 108-118). Out of date: README.md:243-244 now lists exactly this under \"Not done\" (\"A message whose DLR never arrives stays SUBMITTED. A sweeper that expires it after the carrier's validity period is missing\"), so by the review rules the missing sweep is a disclosed limitation, not a finding. What is left: DESIGN.md:55 still says, without a condition, that the message \"reaches one final status\", which the README now contradicts. That is a wording defect. One practical risk remains for the demo: if the gateway is restarted while DLRs are due, those messages never finish and the load script waits until its timeout.",
    "fix": "Smallest honest fix: change DESIGN.md:55 to \"is not lost, is charged once, and gets at most one final status (it needs a DLR to finish; see Not done in the README)\". Better, if there is time: a periodic sweep in the dispatcher or webhook process that moves SUBMITTED messages older than a configurable validity period to EXPIRED through finalize_from_dlr with detail {\"reason\": \"NO_DLR\"} and no refund, plus a longer DLR retry in the mock (exponential, up to about a minute) so a gateway restart during the review call does not strand messages."
  },
  {
    "lens": "spec",
    "title": "README overstates the Prometheus bonus: submit outcomes are never exposed under docker compose and the queue-depth gauge is stale",
    "verdict": "confirmed",
    "severity": "low",
    "file": "README.md",
    "reasoning": "Both parts hold in the current code. (b) Reproduced: three messages sent, no dashboard client, GET /metrics returned `smsgw_queue_depth 0.0` while the table had 3 QUEUED rows. The /metrics handler (api/app.py:84-86) only calls generate_latest(); the gauge is set only inside queries.queue_stats (queries.py:247-248), which runs for /internal/overview (internal.py:164) and for the SSE stats pump, and that pump skips when no client is connected (live.py:137). (a) By reading: SUBMIT_ATTEMPTS and SUBMIT_SECONDS are incremented only in Dispatcher.handle (dispatch.py:415-416), a separate process; runner.py:95-96 serves worker metrics only when METRICS_PORT is set, and `grep METRICS_PORT` finds it only in config.py, metrics.py and runner.py, not in docker-compose.yml, which also publishes no port for dispatcher or webhooks. In the test the same /metrics output had no smsgw_submit_attempts_total sample. So README.md:127-128 (\"/metrics: queue depth, submit outcomes, DLR delay\") is true only for DLR delay, and that only for DLRs applied by the API process, not for early DLRs applied by the dispatcher. The README \"Not done\" entry says only that metrics are per process. Low is right: it is a bonus item with a wrong claim, no effect on messages or money.",
    "fix": "api/app.py /metrics handler: `await queries.queue_stats(app.state.pool)` before generate_latest(), so depth and in-flight are read at scrape time whichever uvicorn worker answers. docker-compose.yml: set METRICS_PORT (for example 9464) in the environment of dispatcher and webhooks, and note in the README that submit outcomes and webhook results are scraped from those containers on that port (with two dispatcher replicas a host port mapping would clash, so say it is reachable inside the compose network). If that is not done, reword README.md:127-128 to what /metrics on port 8000 really exposes."
  },
  {
    "lens": "spec",
    "title": "Webhook HMAC secret cannot be obtained or set by a tenant and is not documented",
    "verdict": "confirmed",
    "severity": "low",
    "file": "gateway/src/gateway/api/tenant.py",
    "reasoning": "Could not refute the core claim. Test: PUT and GET /v1/webhook both return exactly {\"callback_url\": ...}; the database row holds webhook_secret = 'whsec_acme_dev_secret'; the word \"secret\" does not occur in /openapi.json. tenant.py:157-170 reads and writes only callback_url. A grep for `whsec` and `webhook_secret` over the whole repository finds them only in the migration, seed.py:33-35, webhooks.py and one test, and nowhere in README.md, DESIGN.md or docs/API.md, while API.md:185-187 tells the tenant to verify X-Signature \"with the tenant's webhook secret\" and README.md:127 lists the HMAC signature as a bonus that is in. The signing itself works (test_final_state_sends_one_signed_callback). One part of the finding is hypothetical and should be dropped: \"a tenant row created any other way has webhook_secret NULL\" cannot happen today, because tenants exist only through the seed, which always sets a secret. So this is a documentation and API gap on a bonus feature: low.",
    "fix": "Cheapest: add the two seeded secrets as a column in the \"Seed data\" table of docs/API.md (with the same \"development values, not secrets\" note) and one sentence on how to verify the signature. Better: return \"signing_secret\" from GET /v1/webhook, and in PUT generate one with secrets.token_urlsafe when the tenant has none (UPDATE ... SET webhook_secret = COALESCE(webhook_secret, $3)), so the feature is usable through the API; document the field in API.md."
  }
]
```

### refuted

```json
[
  {
    "lens": "delivery",
    "title": "A SUBMITTED message whose DLR never arrives stays SUBMITTED forever, and neither README nor DESIGN.md says so",
    "reasoning": "The code behaviour is as described (only a DLR moves a message out of SUBMITTED; runner.py starts no sweeper), but the claim that makes it a finding, that the docs do not say so, is false. README.md lines 243-244, under 'Not done, and what I would do with more time', read: 'A message whose DLR never arrives stays `SUBMITTED`. A sweeper that expires it after the carrier's validity period is missing.' DESIGN.md line 129 points to the README for assumptions and trade-offs. The review rules exclude anything listed under 'Not done' unless the code contradicts it, and here the code does exactly what is written. The DESIGN.md sentence 'reaches one final status' (line 55) is in the crash-after-accept paragraph and is about not ending in two different final states; it does not promise a deadline. No money is wrong: keeping the charge for an accepted message is what the brief asks. Not a finding."
  },
  {
    "lens": "spec",
    "title": "Recording a late result and re-claiming the same message take row locks in opposite order: PostgreSQL deadlock (the existing test claims the order is the same)",
    "reasoning": "Does not happen in the current code. dispatch.py was changed at 23:59 (after the lines the finding cites): every record function now starts with _lock_message (dispatch.py:180-188, `SELECT 1 FROM messages WHERE id = $1 FOR UPDATE`), called at line 221 in record_accepted (after the carrier_id advisory lock), 252 in record_retry and 274 in record_failed, before _close_attempt. That is the same order as the claim statement (message row, then attempt row). release_claim (164-177) also touches the message first. I ran the reviewer's scenario against the real functions with _close_attempt patched to sleep 0.3 s before and after its UPDATE, for record_retry, record_failed and record_accepted, with the re-claim starting 0.1 s later and at the same instant: all six runs gave ['recorded', 'none'] with no exception; the claim's `FOR UPDATE OF m SKIP LOCKED` (dispatch.py:106) skips the row the recorder holds. If the claim wins instead, it is one statement, and the recorder waits on the message row while holding no attempt row. To show the harness can detect the problem, I also ran the old order by hand (attempt row, sleep, message row) and got ['recorded', 'DeadlockDetectedError'], so the finding was true of the earlier code and the fix removed it. The docstring of test_a_late_result_and_a_reclaim_of_the_same_message_do_not_deadlock is now accurate."
  }
]
```

### raw_counts

```json
[
  {
    "lens": "money",
    "found": 3
  },
  {
    "lens": "delivery",
    "found": 4
  },
  {
    "lens": "fairness",
    "found": 4
  },
  {
    "lens": "api",
    "found": 6
  },
  {
    "lens": "spec",
    "found": 6
  }
]
```
