# Workflow 1: build-satellites

A workflow is a script that the main session wrote to run several sub-agents. The script below holds every prompt the sub-agents received. [Back to the index](../README.md).

| | |
|---|---|
| Started | 2026-11-24 23:20 (UTC+8) |
| Duration | 88.8 minutes |
| Sub-agents | 6 |
| Tool calls by sub-agents | 546 |
| Status | completed |
| Default model | claude-fable-5-2 |
| Run id | wf_b3a3341b-d15 |

## Phases

- **Build**: mock carrier, dashboard and load script in parallel
- **Review**: two independent reviews of the dashboard
- **Fix**: apply the confirmed dashboard findings

## Summary

Build the mock carrier, the Next.js dashboard and the load script against the written contract, then review and fix the dashboard

## Log lines

```text
dashboard review: 20 findings
```

## Script

```js
export const meta = {
  name: 'build-satellites',
  description: 'Build the mock carrier, the Next.js dashboard and the load script against the written contract, then review and fix the dashboard',
  phases: [
    { title: 'Build', detail: 'mock carrier, dashboard and load script in parallel' },
    { title: 'Review', detail: 'two independent reviews of the dashboard' },
    { title: 'Fix', detail: 'apply the confirmed dashboard findings' },
  ],
}

const ROOT = 'C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm'

const COMMON = `
You are one of several engineers building a take-home project in parallel: a mini SMS gateway.
Repository root: ${ROOT}  (Windows 11; Git Bash and PowerShell are available; Node 24, npm 11, uv 0.11 and Python 3.11 are installed; Docker is NOT installed on this machine).

Hard rules:
- Work ONLY inside the directory you are given. Never edit files elsewhere. Never run any git command (no add, commit, stash, checkout). Someone else owns version control.
- The contract is ${ROOT}\\docs\\API.md . Read it first, fully. Follow it exactly: paths, field names, status names, env var names. If you believe the contract is wrong or incomplete, do NOT silently deviate: implement the contract and list the problem in your final report.
- The database schema is ${ROOT}\\gateway\\migrations\\001_init.sql (context only, do not edit).
- Write code a senior engineer would be happy to defend line by line in a review call: small files with one purpose, clear names, comments only where the WHY is not obvious. No dead code, no TODOs, no placeholder features.
- Plain, direct English in comments and docs. No marketing language, no emojis in code or docs.
- Before you finish, run the checks you were asked to run and make them pass. Report honestly: what you built, what you verified by running it, and what you could not verify.
`

const CARRIER_PROMPT = `${COMMON}
YOUR DIRECTORY: ${ROOT}\\mock-carrier

Build the mock carrier and the webhook sink as one small Python project (two FastAPI apps in one package, two processes at run time).

Layout:
  mock-carrier/pyproject.toml        (uv project, requires-python >=3.11, deps: fastapi, uvicorn, httpx; dev group: pytest, pytest-asyncio, ruff)
  mock-carrier/uv.lock               (run "uv sync --python 3.11")
  mock-carrier/Dockerfile            (python:3.13-slim, uv copied from ghcr.io/astral-sh/uv, "uv sync --frozen --no-dev", non-root user, no CMD-specific logic: docker compose sets the command)
  mock-carrier/.dockerignore
  mock-carrier/src/mock_carrier/config.py    (env parsing into a frozen dataclass; every behaviour value configurable exactly as listed in docs/API.md "Mock carrier")
  mock-carrier/src/mock_carrier/carrier.py   (FastAPI app: POST /submit, GET /healthz, GET /stats, POST /reset)
  mock-carrier/src/mock_carrier/sink.py      (FastAPI app: POST /hooks/{tenant_slug}, GET /stats, GET /healthz)
  mock-carrier/tests/...
  mock-carrier/README.md             (short: what it is, how to run each app with uvicorn, the env table)

Run commands that must work:
  uv run uvicorn mock_carrier.carrier:app --port 9000
  uv run uvicorn mock_carrier.sink:app --port 9100

Carrier behaviour (this is the assignment text, follow it precisely):
- POST /submit body { "message_id", "to", "from", "text", "encoding": "GSM7|UCS2" } -> 200 { "carrier_id": "c-<hex>" }. A body with a missing field is 400 { "error": "INVALID_REQUEST" } and does not count as a submit.
- Response time is random between MIN_LATENCY_MS and MAX_LATENCY_MS.
- Rate limit: a sliding one-second window over admitted submits. If RATE_LIMIT_PER_SEC submits were admitted in the last 1000 ms, answer 429 { "error": "RATE_LIMITED" } immediately. A 429 does not count toward the window. Check the rate limit first, before any random outcome.
- P_TEMPORARY_FAILURE of admitted submits: 503 { "error": "TEMPORARY_FAILURE" } after the normal latency. Not accepted, no DLR.
- P_PERMANENT_FAILURE: 400 { "error": "INVALID_DESTINATION" } after the normal latency. Not accepted, no DLR.
- P_TIMEOUT: the carrier ACCEPTS the message (creates a carrier_id, schedules the DLR as normal) but does not answer for TIMEOUT_SECONDS, then answers 504 { "error": "TIMEOUT" }. The client never learns the carrier_id.
- Otherwise: accepted, 200 with the carrier_id after the normal latency.
- For every accepted submit, POST a DLR to {GATEWAY_URL}/carrier/dlr with body { "carrier_id", "status": "DELIVRD|UNDELIV|EXPIRED", "timestamp": ISO-8601 UTC } between DLR_MIN_DELAY_MS and DLR_MAX_DELAY_MS after acceptance. Status mix from P_DELIVRD / P_UNDELIV / P_EXPIRED.
- Every DLR request carries header X-Signature = hex HMAC-SHA256 of the exact raw request body bytes, key DLR_SECRET. Serialise the body once to bytes, sign those bytes, send those same bytes (content=..., Content-Type: application/json).
- P_DLR_DUPLICATE of DLRs are sent twice (the second a short random moment after the first, identical bytes).
- P_DLR_EARLY of accepted submits: the DLR is sent and its HTTP call completes BEFORE the carrier writes its submit response (await the DLR POST, then finish the remaining latency and answer 200). This case ignores the DLR delay range.
- If IDEMPOTENT_SUBMIT=true: a message_id that was already accepted returns the first carrier_id with 200 and creates nothing new (no new DLR). Default false.
- DLR delivery: one shared httpx.AsyncClient; if the gateway is unreachable or answers 5xx, retry up to 3 times with a short backoff, then count it in dlrs_failed. Do not retry a 4xx. DLR sending must never block or slow a /submit response (except the deliberate early case).
- GET /stats returns exactly the shape in docs/API.md. "max_submits_in_one_second" is the largest number of admitted submits ever seen inside the sliding window. "duplicate_accepts" counts accepted submits whose message_id had been accepted before.
- POST /reset clears counters and the accepted-id memory (used between load runs).
- RANDOM_SEED, when set, seeds a private random.Random instance so a run is repeatable.
- Use an asyncio lifespan to create/close the HTTP client and to cancel pending DLR tasks on shutdown. Keep strong references to background tasks.
- Keep it simple. It is a test tool, in memory only, single process.

Webhook sink behaviour: as in docs/API.md "Webhook sink". Slug in env var names is upper-cased with "-" replaced by "_" (acme-bank -> SINK_FAIL_ACME_BANK, SINK_DELAY_MS_ACME_BANK). It verifies nothing; it records count, failures returned and last received time per tenant.

Tests (pytest, async, drive the app through httpx.ASGITransport, replace the outgoing DLR client with a fake that records requests; make probabilities deterministic by setting them to 0 or 1 through config): at least
  - accepted submit returns a carrier_id and a correctly signed DLR is sent (recompute the HMAC over the recorded raw body);
  - the 51st submit inside one second is a 429 and is not counted;
  - 503 and 400 cases send no DLR;
  - the timeout case still sends a DLR and answers 504 (use a tiny TIMEOUT_SECONDS);
  - duplicate DLR is sent twice with identical bytes;
  - early DLR is recorded before the submit response is returned;
  - IDEMPOTENT_SUBMIT returns the same carrier_id and sends one DLR;
  - sink failure share and stats.
Run: "uv run pytest -q" and "uv run ruff check ." and make both pass.

Final report: the file list, the test result line, and anything in the contract you found unclear.
`

const DASHBOARD_PROMPT = `${COMMON}
YOUR DIRECTORY: ${ROOT}\\dashboard

Build the internal dashboard for the SMS gateway. It is graded on implementation quality and usability (loading, empty and error states matter), and the owner wants it to look genuinely good: a calm, dense, professional operations console, not a template and not flashy.

STACK (already researched and decided; these are the current stable versions on npm today, which may be NEWER than what you remember, so check before you assume an API):
  next 16.4.x (App Router), react 19.3.x, typescript (use the latest version that "next build" accepts; npm latest is 7.0.x, if Next or a tool does not support it use the newest 5.x/6.x that works and say so), tailwindcss 4.3.x with @tailwindcss/postcss, @tanstack/react-query 5.x, nuqs 2.x (filters live in the URL), recharts 3.x, lucide-react 1.x, geist (bundled Geist Sans + Geist Mono, no network font fetch at build), next-themes, sonner, zod 4.x, date-fns 4.x, vitest 5.x.
  IMPORTANT: after "npm install", read the documentation that ships inside node_modules for anything you are not sure about (for example node_modules/next/dist/docs if it exists, and each package's README / d.ts). Do not write code against an API from memory if the installed version disagrees.
  Use npm (commit package-lock.json). Do not add a component library beyond what is listed; write the small set of UI primitives yourself in src/components/ui (button, badge, card, input, select, skeleton, table, tooltip, dialog if needed) with Tailwind, accessible and keyboard friendly. Do not run the shadcn CLI.

BACKEND ACCESS
- The browser never talks to the gateway directly and never sees the admin token. Create a Next.js route handler at src/app/api/gateway/[...path]/route.ts that forwards GET/POST to \`\${GATEWAY_URL}/internal/<path>\` (keep the query string), adds header X-Admin-Token from env ADMIN_TOKEN, forwards Idempotency-Key and Content-Type, and streams the response body through unchanged. It must pass Server-Sent Events through without buffering (return the upstream body stream; set Cache-Control: no-cache, no-transform and X-Accel-Buffering: no; export const dynamic = "force-dynamic"; abort the upstream fetch when the client disconnects). Env: GATEWAY_URL (default http://localhost:8000), ADMIN_TOKEN (default dev-admin-token). If the gateway is unreachable answer 502 with the standard error shape and code "GATEWAY_UNREACHABLE".
- All internal endpoints and their exact JSON are in docs/API.md, section "Internal API (dashboard)". Write zod schemas + inferred types for every response in src/lib/api/schemas.ts and parse every response; a parse failure is shown as an error state, not swallowed.
- The real gateway may not be running while you work. Do not add a mock server to the repo. You may write a throwaway mock outside the repo if you need one to try something.

PAGES
1. /  Overview
   - One card per tenant: name, balance (formatted from micros, 4 decimals where needed, e.g. $249.9960), opening balance, a thin stacked proportion bar of the seven statuses, and the seven counts as a compact grid. Live.
   - A "pipeline" strip that shows the state machine as a flow with live totals across tenants: ACCEPTED -> QUEUED -> SUBMITTED -> DELIVERED | UNDELIVERED | EXPIRED, with FAILED branching from QUEUED. This doubles as the legend for status colours.
   - Throughput chart (recharts): submits per second for the last 60 seconds as an area, finalized per second as a line, and a dashed reference line at the carrier limit (carrier.limit_per_second). Seed from GET /internal/overview, then append from the SSE "stats" events.
   - Small stat tiles: queue depth, oldest queued age, in flight, webhooks pending / delivered / dead, billing consistency (green "Ledger consistent" or a red alert naming the tenant).
2. /messages  Message list
   - Filter bar: tenant (select, "All tenants"), status (select, "All statuses"), date range (quick presets: 15 min, 1 h, 24 h, 7 d, All; plus custom from/to datetime-local inputs), and a search box (exact match on message ID, destination number or client_ref; debounce 300 ms). All filter state lives in the URL via nuqs so a view can be shared and survives reload. A "Clear filters" button appears when any filter is set.
   - Table: time (relative, absolute on hover), tenant, to, from, status badge, encoding, segments, cost, attempts (highlight when > 1; show a small warning mark when ambiguous_attempts > 0 with tooltip "An attempt had no answer. The carrier may have accepted it more than once."). Monospace for numbers, phone numbers and IDs. Row click and Enter open the detail page. Sticky header.
   - Cursor pagination with a "Load more" button (useInfiniteQuery, limit 50).
   - Live: when an SSE "message" event arrives for a row that is loaded, patch that row in the query cache at once and flash it briefly. When events arrive for messages that are not loaded and the current filters could match them, do not reorder under the user: show a pill "N new messages" at the top that refetches the first page when clicked. A "batch" event counts its "count" into that pill. Provide a Live on/off toggle.
   - Loading: skeleton rows. Empty: different text for "no messages yet" and "no messages match these filters" (with the clear button). Error: message + Retry.
3. /messages/[id]  Message detail
   - Header: status badge, message ID with copy button, tenant, created time.
   - Facts grid: to, from, client_ref, encoding, segments, cost, attempts, carrier_id, failure_reason, batch_id.
   - The message text in a readable block.
   - Full event history as a vertical timeline, oldest first, merging: status events (primary nodes, with the delta time since the previous status, e.g. "+182 ms"), submit attempts (outcome, HTTP status, worker, duration), DLR receipts (status, disposition, carrier timestamp), ledger entries (charge/refund with amount and balance after) and webhook deliveries (status, attempts, HTTP status, last error). Sort by time. Each kind has its own icon and label so the status path stays easy to follow.
   - Live: an SSE "message" event for this ID refetches the detail. Not found (404) gets a proper not-found state with a link back.
4. /send  Send test message
   - Form: tenant (select), to, from, text (textarea), client_ref (optional). Submit calls POST /internal/tenants/{id}/messages with a fresh Idempotency-Key per submit attempt generated when the form is first submitted and reused on retry of the same content (so a double click cannot send twice).
   - A live preview panel that updates on every keystroke with NO network call: encoding (GSM-7 or UCS-2), units used and capacity of the current segment count (e.g. "163 / 306 septets"), segment count, price per segment for the destination prefix (longest matching prefix from GET /internal/prices), total cost, and the tenant balance after sending. If the text is UCS-2, list the characters that forced it (unique, with their code points) so the user can see why the price went up. Show the text split into its segments as blocks so the split is visible. If the destination has no price, say so clearly and disable submit. Validate "to" as E.164 (^\\+[1-9]\\d{6,14}$) and "from" (1-11 chars of A-Z a-z 0-9 space, or 3-15 digits) inline, with the same rules as the server; do not auto-correct input.
   - Server errors: map details[].field to the fields; show INSUFFICIENT_BALANCE and others as a clear alert.
   - On success: a toast and an inline result card with the message ID, a link to its detail page and its status, which keeps updating live from SSE.

SMS ENCODING LIBRARY
- Port ${ROOT}\\gateway\\src\\gateway\\encoding.py to src/lib/sms-encoding.ts exactly (same GSM 03.38 basic and extension sets, same packing rule that never splits a two-unit character across segments; iterate by code point, not by UTF-16 unit). Also export a function that returns the per-segment slices of the text for the visualiser, and one that returns the characters that force UCS-2.
- Add a vitest test that loads ${ROOT}\\shared\\encoding-vectors.json (path relative to the dashboard: ../shared/encoding-vectors.json) and asserts encoding, units and segments for every vector. Add tests for the money formatter and the prefix price lookup too.

LIVE DATA
- One EventSource for the whole app (a provider near the root) to /api/gateway/stream. Expose connection state (connecting / live / reconnecting) and show it in the top bar as a small dot + label. Reconnect with backoff; after a reconnect, invalidate queries because the stream is best-effort. Components subscribe to event types through a small typed hook. Put "stats" events into the react-query cache so tenant cards and tiles update without polling; keep a slow polling fallback (15 s) only while the stream is not live.

DESIGN DIRECTION (follow this; do not improvise a different look)
- Feel: a control-room tool. Quiet neutral surfaces, strong typographic hierarchy, colour used only to carry meaning (status), generous alignment on a 4 px grid, tabular numbers everywhere numbers are compared.
- Themes: light and dark with CSS variables in globals.css (Tailwind v4 @theme), default to the system theme, toggle in the top bar. Check contrast in both.
- Type: Geist Sans for UI, Geist Mono for IDs, phone numbers, amounts and counters. Base 14 px. Use font-variant-numeric: tabular-nums.
- Layout: fixed left sidebar (product mark "SMS Gateway" + "Internal console", nav: Overview, Messages, Send test) that collapses to a top nav under 768 px; content max width about 1400 px; page header with title + one line of context.
- Status colours, used consistently for badges, bars, timeline nodes and the pipeline (define once as tokens): ACCEPTED slate, QUEUED amber, SUBMITTED blue, DELIVERED green, UNDELIVERED orange, EXPIRED violet, FAILED red. Badges are a small dot + label on a tinted background; never rely on colour alone.
- Motion: subtle and purposeful only (row flash on live update, number changes, skeleton shimmer). Respect prefers-reduced-motion.
- Accessibility: semantic HTML (real table, real buttons, labels on inputs), visible focus rings, aria-live for the connection state and for form results, keyboard reachable everywhere.
- Every data region has explicit loading (skeleton shaped like the content), empty and error (what failed + Retry) states. No layout shift between them.

PROJECT
- src/ directory, App Router, strict TypeScript, path alias @/*. ESLint with the Next config (flat config). Scripts: dev, build, start, lint, typecheck (tsc --noEmit), test (vitest run).
- next.config: output "standalone".
- Dockerfile: multi-stage on node:24-alpine (deps -> build -> runner using .next/standalone, non-root user, PORT 3000, HOSTNAME 0.0.0.0). .dockerignore. Build context is the dashboard directory only.
- README.md (short): how to run in dev, env vars, structure, how live updates work.
- Keep files focused. Suggested structure: src/app/(console)/layout.tsx + page.tsx, messages/page.tsx, messages/[id]/page.tsx, send/page.tsx; src/components/{layout,overview,messages,send,ui}; src/lib/{api,live,format.ts,sms-encoding.ts,pricing.ts,status.ts}.

VERIFY before you finish (all must pass, fix what fails): npm run lint, npm run typecheck, npm run test, npm run build. Then start the production server briefly (npm run start on a free port such as 3111 with GATEWAY_URL pointing at a closed port) and confirm with curl that /, /messages, /send return 200 HTML and /api/gateway/tenants returns 502 with code GATEWAY_UNREACHABLE; stop the server.

Final report: versions actually installed, any deviation from the stack with the reason, the result line of each check, and anything in the contract you found unclear or missing for the UI.
`

const LOADTEST_PROMPT = `${COMMON}
YOUR DIRECTORY: ${ROOT}\\loadtest

Write the load script required by the assignment as a single well-structured Python file: ${ROOT}\\loadtest\\load_test.py (plus a short README.md). It must run in two ways:
  1. "uv run loadtest/load_test.py" from the repo root (use PEP 723 inline script metadata; dependency: httpx; requires-python >=3.11);
  2. inside the gateway's Docker image, where httpx is already installed, as "python /app/loadtest/load_test.py".
It talks ONLY to public HTTP APIs: the gateway tenant API (docs/API.md "Tenant API") with the two seeded API keys (docs/API.md "Seed data"), and optionally the mock carrier's GET /stats and POST /reset. No database access.

What the assignment requires (follow precisely):
"Write a script that sends 10,000 ShopFast messages and, at the same time, one Acme Bank OTP every second. When all messages reach a final state, the script prints: the total time and the average submit rate to the carrier; the time from accept to SUBMITTED for the OTP messages (p50 and p95); the count of messages in each final state; a billing check: for each tenant, the balance equals the opening balance minus the ledger, and no message is charged twice."

Design:
- CLI (argparse) with env fallbacks: --gateway-url (GATEWAY_URL, default http://localhost:8000), --carrier-url (CARRIER_URL, default http://localhost:9000, empty string disables carrier stats), --shopfast-key / --acme-key (defaults: the seeded dev keys), --messages 10000, --batch-size 1000, --otp-interval 1.0, --timeout 900 (overall deadline in seconds), --run-id (default: short random hex; used as a prefix in client_ref so each run's messages can be told apart: "load-<run>-c-<n>" for campaign, "load-<run>-otp-<n>" for OTP).
- Before sending: read GET /v1/balance and GET /v1/messages/stats for both tenants (baseline), and POST {carrier}/reset if the carrier URL is set (ignore failure, print a warning).
- Campaign: POST /v1/messages/batch in batches of --batch-size with an Idempotency-Key per batch ("<run>-batch-<i>"), sent sequentially without pause (the gateway queues them). Destination numbers are distinct valid Bangladesh numbers: "+88017" + 8 digits derived from the run and the index. Sender "SHOPFAST". Text: a realistic GSM-7 one-segment marketing line. On a network error or 5xx, retry the SAME batch with the SAME Idempotency-Key (this is what the key is for) up to 5 times; any other 4xx is fatal with the error body printed.
- OTP: concurrently, from the moment the campaign starts, send one Acme Bank message per --otp-interval seconds with POST /v1/messages (to a +971 number, sender "ACME", text "Your Acme Bank code is <6 digits>", Idempotency-Key per OTP) and keep sending until every campaign message is final. Use a fixed-rate schedule (do not drift).
- Progress: every 5 seconds print one line with elapsed time and the campaign status counts from GET /v1/messages/stats (minus the baseline).
- Completion: all messages of this run are final when, for each tenant, (count of final statuses now - baseline) equals the number of messages this run sent for that tenant. Final statuses: DELIVERED, UNDELIVERED, EXPIRED, FAILED. After the campaign is final, stop the OTP sender and wait for the remaining OTPs to become final as well. Fail with a clear message and a non-zero exit code if --timeout passes.
- OTP latency: for each OTP, GET /v1/messages/{id}, take events[].occurred_at for ACCEPTED and SUBMITTED and compute the difference in milliseconds. OTPs that never reached SUBMITTED (FAILED) are listed as a count and excluded. Print n, p50, p95 and max. Fetch with bounded concurrency (10).
- Submit rate: page through GET /v1/messages for both tenants filtered to this run's time window (created_from = run start) with limit 1000 and collect, for this run's messages only (client_ref prefix), the "attempts" sum and min/max of submitted_at. Print: total submit attempts, the window from first to last submitted_at, and the average rate = attempts / window seconds. If carrier stats are available also print the carrier's own numbers from GET /stats: received, accepted, rate_limited (429), max_submits_in_one_second (and state clearly whether it stayed <= 50), timeouts, duplicate_accepts.
- Final state counts: per tenant and total, for this run.
- Billing check, per tenant, computed by the script itself from the API, not trusted from a flag: (a) page through the whole GET /v1/ledger and sum amount_micros; assert balance_micros == opening_balance_micros - ledger sum; (b) assert no message_id has more than one CHARGE and no more than one REFUND; (c) for this run's messages: every FAILED message has exactly one REFUND equal to minus its CHARGE, and no non-FAILED message has a REFUND; (d) the balance never negative. Print PASS/FAIL per check and exit non-zero if any fails.
- Output: a clean, aligned plain-text report that reads well when pasted into a README (no ANSI colours, no emojis). Start with a header that states the parameters and the UTC start time. Use time.monotonic() for durations.
- Code quality: asyncio + one httpx.AsyncClient per base URL, type hints, small functions, dataclasses for results, a percentile function with a docstring that states the method (nearest-rank). No external dependency besides httpx.

You cannot run it against a real gateway now (the gateway is being written in parallel). Do: "uv run --with ruff ruff check loadtest/load_test.py" from the repo root, and "uv run loadtest/load_test.py --help". Also write a tiny self-check you run once and then delete: a fake in-process gateway built with httpx.MockTransport is NOT required; instead unit-check the pure functions (percentile, number generation, report formatting) from a python -c snippet.

README.md in loadtest/: how to run it locally and through docker compose ("docker compose run --rm loadtest"), the flags, and what each section of the report means.

Final report: what you verified, and every place where the contract did not give you a field you needed.
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
          file: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['title', 'file', 'severity', 'problem', 'fix'],
      },
    },
  },
  required: ['findings'],
}

const REVIEW_COMMON = `
Repository root: ${ROOT}. Review ONLY the dashboard at ${ROOT}\\dashboard (a Next.js internal console for an SMS gateway). The contract it must follow is ${ROOT}\\docs\\API.md (section "Internal API (dashboard)"). Do not edit any file and do not run git. You may run npm scripts (lint, typecheck, test, build) to check claims.
Report only real, specific problems you verified by reading the code (file + what is wrong + the concrete fix). No style opinions, no speculative issues, no praise. If something is fine, do not mention it. At most 12 findings, most severe first.`

phase('Build')
const builds = await parallel([
  () => agent(CARRIER_PROMPT, { label: 'build:mock-carrier', phase: 'Build' }),
  () => agent(DASHBOARD_PROMPT, { label: 'build:dashboard', phase: 'Build' }),
  () => agent(LOADTEST_PROMPT, { label: 'build:loadtest', phase: 'Build' }),
])

phase('Review')
const reviews = await parallel([
  () => agent(`${REVIEW_COMMON}
Lens: CORRECTNESS. Check: every fetch matches the contract (paths, query names, field names, status names); zod schemas match the documented JSON exactly (nullable fields!); the proxy route streams SSE without buffering, forwards the right headers, handles upstream failure, never leaks the admin token to the client bundle; the EventSource lifecycle (single connection, cleanup, reconnect, no duplicate listeners, no state updates after unmount); query cache patching on live events is correct and cannot corrupt pagination; the idempotency key logic on the send form really prevents a double send; cursor pagination; URL filter state; the TypeScript SMS encoding port is identical to ${ROOT}\\gateway\\src\\gateway\\encoding.py including the packing rule and code-point iteration; money formatting never uses floating point in a way that can show a wrong amount; hydration mismatches (dates, theme); memory growth under 200 events per second (unbounded arrays, re-render storms).`, { label: 'review:correctness', phase: 'Review', schema: FINDINGS }),
  () => agent(`${REVIEW_COMMON}
Lens: USABILITY, STATES AND ACCESSIBILITY. Check every page (overview, message list, message detail, send form) for: a real loading state shaped like the content, a real empty state with useful text, a real error state with a retry; behaviour when the gateway is down and when the stream drops; forms (labels, inline validation text, disabled and pending states, error mapping from the server, focus management after submit); keyboard access and visible focus; semantic HTML (table, headings order, buttons vs links); colour is never the only carrier of status; contrast problems in the light or the dark theme (read the CSS tokens and compute); responsive behaviour under 768 px; prefers-reduced-motion; anything that would confuse an operator reading the screen during an incident (ambiguous labels, missing units, timezones not stated, numbers that jump around because they are not tabular).`, { label: 'review:usability', phase: 'Review', schema: FINDINGS }),
])

const findings = reviews.filter(Boolean).flatMap(r => r.findings)
log(`dashboard review: ${findings.length} findings`)

phase('Fix')
let fixReport = 'no findings'
if (findings.length) {
  fixReport = await agent(`${COMMON}
YOUR DIRECTORY: ${ROOT}\\dashboard

Two reviewers examined the dashboard you are now responsible for. Their findings are below as JSON. For each one: read the code, decide whether it is real, and if it is, fix it properly (not a patch that hides the symptom). If a finding is wrong, skip it and say why in one line. Do not rewrite things that were not flagged and do not change the visual design direction.

FINDINGS:
${JSON.stringify(findings, null, 2)}

After the fixes run and pass: npm run lint, npm run typecheck, npm run test, npm run build.
Final report: one line per finding (fixed / rejected + reason), and the result line of each check.`, { label: 'fix:dashboard', phase: 'Fix' })
}

return { builds, findings, fixReport }

```

## What the sub-agents returned

### builds

```json
[
  "Mock carrier and webhook sink are built in `C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\mock-carrier`; `uv run pytest -q` gives `61 passed in 1.65s` and `uv run ruff check .` gives `All checks passed!`. The Dockerfile was not built, because Docker is not installed here.\n\n## Files\n\nAll paths are under `C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\mock-carrier\\`.\n\n- `pyproject.toml`, `uv.lock` (created with `uv sync --python 3.11`)\n- `Dockerfile`, `.dockerignore`\n- `README.md`\n- `src/mock_carrier/__init__.py`\n- `src/mock_carrier/config.py` — `CarrierConfig` and `SinkConfig`, frozen dataclasses with `from_env`\n- `src/mock_carrier/carrier.py` — the carrier FastAPI app, lifespan and routes\n- `src/mock_carrier/submit.py` — `SubmitHandler`: rate limit, outcome draw, accept, idempotent replay\n- `src/mock_carrier/dlr.py` — `DlrSender`: build, sign, send, retry, duplicate, task tracking\n- `src/mock_carrier/rate_limit.py` — `SlidingWindow`\n- `src/mock_carrier/stats.py` — `CarrierStats`, whose field order is the `/stats` shape\n- `src/mock_carrier/clock.py` — `utc_now_iso()`\n- `src/mock_carrier/sink.py` — the sink FastAPI app\n- `tests/conftest.py`, `tests/support.py`\n- `tests/test_submit.py`, `tests/test_dlr.py`, `tests/test_rate_limit.py`, `tests/test_config.py`, `tests/test_sink.py`\n\n`submit.py`, `dlr.py`, `rate_limit.py`, `stats.py` and `clock.py` are additions to the requested layout, to keep each file to one purpose.\n\n## Verified by running\n\n- **Tests:** all the cases you listed are covered, plus DLR retry behaviour, shutdown cancelling pending DLRs, config defaults against the contract, and seed repeatability. The suite ran 7 times in a row with no flakes.\n- **Both run commands over real HTTP:** `uv run uvicorn mock_carrier.carrier:app --port 9000` and `uv run uvicorn mock_carrier.sink:app --port 9100` started and served.\n- **600 submits at about 45/s against a scratch stub gateway that checks the HMAC:**\n  - Carrier counted 564 accepted, 9 rate limited, 22 temporary failures, 5 permanent failures, 9 timeouts.\n  - `dlrs_sent` was 618 and `dlrs_failed` was 0; the stub received 618 DLRs with 0 bad signatures, for 564 unique carrier IDs, 54 of them sent twice.\n  - `max_submits_in_one_second` was 50.\n- **Burst of 200 submits in under a second:** exactly 50 admitted, 150 answered 429.\n- **Gateway down:** `/submit` still answered in 0.29 s, and the DLR ended in `dlrs_failed` after its retries.\n- **Bad environment value:** `P_TIMEOUT=2` stops the app at import with the variable name in the error.\n- **Sink:** `SINK_FAIL_SHOPFAST=1` returned 500, `SINK_DELAY_MS_ACME_BANK=200-300` delayed the answer by 0.27 s, and an unconfigured tenant got 200.\n\n## Not verified\n\n- **Docker build.** I confirmed that the `ghcr.io/astral-sh/uv:0.11.18` tag exists and that `uv sync --frozen --no-dev --dry-run` resolves from the lock, nothing more.\n- **The real gateway.** Nothing was run against it; only the scratch stub.\n\nThe Dockerfile has no `CMD`. Compose needs `uvicorn mock_carrier.carrier:app --host 0.0.0.0 --port 9000` and `uvicorn mock_carrier.sink:app --host 0.0.0.0 --port 9100`; the virtualenv is on `PATH`.\n\n## Contract points that were unclear, and what I did\n\n1. **`DLR_SECRET` has no default in the table.** I default it to `dev-dlr-secret`, the documented demo value, so the bare run command starts.\n2. **`IDEMPOTENT_SUBMIT` replays have no counter in `/stats`.** A replay is counted in `received` only, so in that mode `received` is larger than accepted + rate limited + failures. I kept the shape exactly as documented and did not add a field.\n3. **`IDEMPOTENT_SUBMIT` against the gateway schema.** A replay returns the same `carrier_id` for a second attempt, and `001_init.sql` has a unique index on `submit_attempts.carrier_id`. The gateway has to expect that when the flag is on.\n4. **`accepted` and timeouts.** `accepted` includes timeouts, so `accepted = unique_message_ids_accepted + duplicate_accepts`. The example numbers in API.md do not add up under any reading.\n5. **`received`, `first_submit_at`, `last_submit_at`.** They cover every well-formed submit, including 429s. A 400 `INVALID_REQUEST` is counted nowhere.\n6. **`dlrs_sent` and `dlrs_failed`.** `dlrs_sent` counts DLR requests answered 2xx, duplicates included. `dlrs_failed` counts those given up on: any 4xx at once, or no 2xx after three retries. A 401 for a bad signature therefore shows as failed.\n7. **Does `P_DLR_EARLY` apply to timeouts?** I apply it only to submits answered 200; a timeout's DLR follows the normal delay range.\n8. **Order of the idempotent check.** It runs after the rate limit (a replay uses a window slot) and before the random outcome, and always answers 200 after normal latency.\n9. **Response bodies for `/healthz` and `/reset`.** Unspecified; I return `{\"status\":\"ok\"}` and `{\"status\":\"reset\"}`.\n10. **`/reset` and scheduled DLRs.** Reset does not cancel them and does not clear the rate-limit window. DLRs scheduled before a reset are still sent and counted afterwards, so a load script should let them drain first.\n11. **Sink shapes are unspecified.** `/stats` returns `{\"tenants\": {\"<slug>\": {\"received\", \"failed\", \"last_received_at\"}}}`. Success is `200 {\"status\":\"ok\"}` and failure is `500 {\"error\":\"SINK_FAILURE\"}`. `SINK_DELAY_MS_<SLUG>` accepts only `min-max`.\n12. **`RANDOM_SEED` and carrier IDs.** The seed fixes outcomes, latencies, DLR statuses and delays for submits arriving in the same order. Carrier IDs are always fresh (`c-` plus uuid4 hex), because a restart with the same seed would otherwise collide with the gateway's unique index.\n13. **DLR timestamp format.** I send microseconds (`2026-11-24T15:04:05.123456Z`) per the Conventions section; the DLR example in API.md shows whole seconds.\n14. **Extra validation not in the contract.** `RATE_LIMIT_PER_SEC` must be at least 1, the three submit shares must sum to at most 1, and the DLR status shares are treated as weights.\n15. **Constants not in the contract.** DLR retry backoff is 0.2 s, 0.5 s, 1 s; the duplicate goes out 50 to 500 ms after the first; the DLR HTTP timeout is 5 s. These are constants, not env vars. An early DLR to an unreachable gateway delays that one submit response by the retries.",
  "DASHBOARD REPORT — C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\n\nAll four required checks pass. Verified against a throwaway mock gateway kept outside the repo. Not verified: the Docker build (no Docker on this machine) and the real gateway.\n\n## Check results (final run, after the last edit)\n- `npm run lint` -> exit 0, no warnings\n- `npm run typecheck` -> exit 0 (also passes on a fresh tree with no `.next` and no `next-env.d.ts`)\n- `npm run test` -> Test Files 7 passed (7), Tests 162 passed (162)\n- `npm run build` -> exit 0. Routes: `/`, `/messages`, `/send`, `/icon.svg` static; `/messages/[id]`, `/api/gateway/[...path]` dynamic\n- Production smoke (`PORT=3111 GATEWAY_URL=http://127.0.0.1:59999 npm run start`, then curl; server stopped afterwards):\n  - `/` 200 text/html, `/messages` 200 text/html, `/send` 200 text/html, `/nope` 404\n  - `/api/gateway/tenants` -> 502 `{\"error\":{\"code\":\"GATEWAY_UNREACHABLE\",...}}`\n  - CSS and JS chunks under `/_next/static` 200; `dev-admin-token` appears in neither the HTML nor `.next/static`\n\n## Versions installed\nnext 16.4.6, react / react-dom 19.3.1, typescript 6.0.3, tailwindcss + @tailwindcss/postcss 4.3.5, @tanstack/react-query 5.108.4, nuqs 2.10.3, recharts 3.11.1, lucide-react 1.79.0, geist 1.9.2, next-themes 0.4.6, sonner 2.0.8, zod 4.6.7, date-fns 4.4.0, vitest 5.1.1, vite 8.3.8, eslint 10.15.0, eslint-config-next 16.4.6, prettier 3.10.1, @types/node 24.19.2, @types/react 19.3.0. npm, with `package-lock.json`.\n\n## Deviations from the brief\n1. **TypeScript 6.0.3, not 7.0.2.** `next build` accepts TS 7, but typescript-eslint 8.74 (inside eslint-config-next) refuses it (\"typescript-eslint does not support TS 7.0\"), so `npm run lint` cannot run. 6.0.3 is the newest version every tool accepts.\n2. **`npm run start` is `node .next/standalone/server.js`, not `next start`.** With `output: \"standalone\"`, `next start` prints a warning that it \"does not work\". `npm run build` is therefore `next build && node scripts/copy-standalone-assets.mjs` (copies `.next/static` into the standalone folder). The Dockerfile runner copies only `.next/standalone`.\n3. **The overview query polls every 15 s even while the stream is live.** Webhook totals and the billing check are not in the `stats` event, so they would otherwise go stale. Tenants and message detail poll only while the stream is not live, as specified.\n4. **Added beyond the list:** `prettier` (dev dependency, `format` script, whole tree formatted) and `vite` (peer of vitest, made explicit).\n5. **`agentRules: false` in `next.config.ts`.** `next dev` detected an AI tool and wrote an `AGENTS.md` into the dashboard directory. I deleted that generated file and turned the feature off; say if you want it back.\n6. **`next.config.ts` pins `outputFileTracingRoot` and `turbopack.root` to the dashboard directory.** A stray `C:\\Users\\Ico\\package-lock.json` made Next warn about the project root.\n7. **Search debounce (300 ms) is in the `SearchBox` component, not nuqs's `limitUrlUpdates`,** so the URL and the query change together.\n8. Input, select and textarea live in one file, `src/components/ui/field.tsx`. No dialog was needed. `npm install` prints ERESOLVE peer warnings (ESLint 10 against plugins inside eslint-config-next); the Next docs describe this as expected.\n\n## What was built\n- **Proxy** `src/app/api/gateway/[...path]/route.ts`: GET and POST to `${GATEWAY_URL}/internal/<path>` with the query string. Adds `X-Admin-Token`, forwards `Accept`, `Content-Type`, `Idempotency-Key`, streams the body back, forwards `Idempotent-Replay`. 502 `GATEWAY_UNREACHABLE` when the gateway is down.\n- **API layer** `src/lib/api/`: zod schemas for every internal response, the error shape and the three stream events. Every response is parsed; a mismatch becomes an `INVALID_RESPONSE` error state that names the path and field.\n- **Live** `src/lib/live/`: one EventSource, states connecting / live / reconnecting in the top bar. Backoff 1 s to 15 s with jitter, plus a reconnect after 10 s of silence. All queries are invalidated after a gap. `stats` events are written into the query cache.\n- **Pages:** Overview, Messages, Message detail, Send test, as specified. Each data region has loading, empty and error states.\n- **Encoding** `src/lib/sms-encoding.ts`: port of `encoding.py`, plus per-segment slices with units and the characters that force UCS-2.\n- **Tests (7 files):** all 32 shared vectors for encoding, units, segments and the segment split; money formatter; prefix price lookup; validation rules; stats-to-cache merge and backoff; live list rules; timeline merge.\n- Dockerfile (three stages on node:24-alpine, `node` user, PORT 3000, HOSTNAME 0.0.0.0), `.dockerignore`, `.env.example`, `README.md`.\n\n## Verified by running it (mock gateway, production build and dev server, built-in browser)\n- **Stream through the proxy:** the first bytes arrive at once and `stats` follows each second, on both `next start` and the standalone server. Closing the client closes the upstream connection (the mock logged the close).\n- **Proxy forwarding:** POST with `Idempotency-Key`, query strings, and upstream 404 / 202 statuses pass through.\n- **Overview:** live tiles, pipeline, chart extending each second, tenant cards. With the mock killed, the page shows \"Reconnecting\" and an error state with Retry in every region; after restart it returns to \"Live\" and refetches without user action.\n- **Messages:** skeleton, table, filters restored from the URL (`?status=FAILED&range=24h`), the \"no match\" empty state, the \"N new messages\" pill (batch of 1,000 plus single messages), tooltip placement, row to detail.\n- **Detail:** full merged timeline with deltas, in light and dark.\n- **Send:** live preview with a UCS-2 text (culprit characters, two segment blocks, cost, balance after). Success shows a toast and a result card whose status moved Queued to Delivered from the stream. A 422 maps to the `from` field. A dropped connection followed by a retry sent the same Idempotency-Key twice in the mock log; changed content got a new key. A destination with no price shows the message and disables submit.\n- **Layout:** 1440 px and 375 px. The browser console is clean in the production build.\n- **Colour:** 43 token pairs per theme computed at or above WCAG 4.5:1 for text and 3:1 for marks.\n\n## Not verified\n- `docker build` (written to the standard standalone layout, never run).\n- Anything against the real gateway.\n- Firefox and Safari, and a screen reader pass (semantics and ARIA are in place but were not tested with assistive technology).\n- The not-found state and the row flash were not looked at in the browser. The empty \"no messages yet\" state was not triggered either.\n- Green and orange (DELIVERED next to UNDELIVERED) are in the validator's warning band for deuteranopia (ΔE about 7.4). Labels and counts always accompany them. Slate for ACCEPTED is neutral by specification.\n\n## Contract points that are unclear or missing for the UI (docs/API.md)\n1. **`stats` has no `webhooks` and no `billing`.** Those tiles can only refresh through `GET /internal/overview` (see deviation 3). Adding both to `stats` would remove the poll.\n2. **`batch` versus `message` events.** The contract does not say whether messages of a batch also emit their own `message` events on acceptance. The UI counts a batch once and skips `message` events whose `batch_id` was already counted, so either behaviour gives the right number.\n3. **`queue.oldest_age_ms` with an empty queue.** The schema requires a number, as the examples show. If the gateway sends `null` there, the overview shows an error state. The tile shows \"None\" when `depth` is 0.\n4. **Prices have no currency.** The per-segment price and total are shown as USD; the balance uses the tenant's currency.\n5. **`created_from` / `created_to`:** inclusive or exclusive is not stated. The UI sends UTC ISO instants; presets are resolved to `created_from = now - range` at request time.\n6. **`events[].detail` keys are not specified.** The timeline prints whatever keys arrive as `key value`.\n7. **`POST /internal/tenants/{id}/messages` with an unknown tenant:** the response is not specified. Any error without field details is shown as a general alert.\n8. **`webhooks[].next_attempt_at`** is accepted as nullable (the example shows a value even for a delivered webhook); it is displayed only while the status is PENDING.\n9. The stream's `tenant_id` filter is not used; the app keeps one unfiltered stream and filters in the browser.\n10. Timestamps have microsecond precision and records in one transaction can be under 1 ms apart. The timeline sorts on microseconds parsed from the string, with a fixed tie order (status, ledger, attempt, receipt, webhook).\n\n## Key files\n- C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\app\\api\\gateway\\[...path]\\route.ts\n- C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\lib\\api\\schemas.ts\n- C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\lib\\live\\connection.ts\n- C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\lib\\sms-encoding.ts\n- C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\components\\messages\\live-list.ts\n- C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\app\\globals.css\n- C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\Dockerfile\n- C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\README.md\n\nNo git command was run and nothing outside the dashboard directory was edited. The mock gateway used for manual testing is at C:\\Users\\Ico\\AppData\\Local\\Temp\\claude\\0aaf5675402adb95\\e1bcbcbb-6672-4634-a789-27e2e0879529\\scratchpad\\mock-gateway.mjs, outside the repo. All test servers are stopped.",
  "## Load test: report\n\n### Files\n- `C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\loadtest\\load_test.py` (single file, PEP 723 header: `requires-python >=3.11`, dependency `httpx`)\n- `C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\loadtest\\README.md`\n\nNothing outside `loadtest/` was edited and no git command was run. My ruff runs from the repo root created `.ruff_cache/` there; it is already in `.gitignore`.\n\n### What was built\nThe script follows the design given; the points worth knowing:\n- **Concurrency:** one `asyncio.TaskGroup` holds the OTP sender, the progress printer and the campaign. The whole load phase sits in `asyncio.timeout(--timeout)`.\n- **Retries:** network errors and 5xx are retried up to 5 times with the same `Idempotency-Key` (0.5 s doubling backoff); any 4xx is fatal and prints the body. Each retry prints a `! retry n/5 ...` line.\n- **OTP schedule:** OTP n is due at `start + n * interval` and each send is its own task, so a slow response does not shift the schedule.\n- **Exit codes:** 0 billing passes, 1 a billing check fails, 2 the run could not finish (timeout, fatal API error, bad arguments).\n\nTwo things I added beyond the design:\n- A seventh billing check, \"run: each message charged once, at its cost\". Check (c) needs the CHARGE anyway.\n- A warning at the start if either tenant already has non-final messages, because completion is detected from counter deltas.\n\n### Verified by running\n- `uv run --with ruff ruff check loadtest/load_test.py` passes. It also passes with the gateway's own rule set (`E,F,I,UP,B,ASYNC,SIM,RUF`, py311), and the file is `ruff format` clean at line length 100.\n- `uv run loadtest/load_test.py --help` works from the repo root.\n- **Pure functions:** a one-off self-check passed and was deleted. It covered `percentile` (nearest-rank), number generation (10,000 distinct valid `+88017…` numbers, 5,000 distinct `+97150…`), the campaign text being one GSM-7 segment, `client_ref` length, money and time formatting, OTP latency from events, every billing check passing and failing, and the table and report formatting (ASCII only).\n- **End to end against a throwaway stub, not the real gateway.** The stub was an in-memory HTTP server implementing the contract's tenant API and carrier `/stats` and `/reset`; it lived in the scratchpad and is deleted. Cases run:\n\n| Case | Result |\n|---|---|\n| 2,500 messages in 7 batches, OTP every 0.2 s, every batch answered 503 after being applied | Retries were replayed by key, exactly 2,500 accepted, exit 0 |\n| Three-page message list and ledger | Paging worked |\n| Second run on the same stub (non-zero baseline) | Exit 0 |\n| Injected double CHARGE | Exit 1, the right two checks failed |\n| Messages stuck in QUEUED | Exit 2 with \"timed out … Final so far …\" |\n| Wrong API key | Exit 2 with the 401 body |\n| Gateway down | 5 retries, then exit 2 |\n| Carrier unreachable | Warning, run continues |\n| `--carrier-url \"\"` | Carrier section omitted |\n| Invalid `--batch-size` and `--run-id` | Rejected by argparse |\n\n### Not verified\n- **The real gateway and mock carrier.** They did not exist yet, so no real throughput or latency numbers exist. The snippets in the README are labelled as illustrative.\n- **`docker compose run --rm loadtest`.** There is no compose file or Docker on this machine. The script needs Python 3.11 or newer in the image, plus `GATEWAY_URL` and `CARRIER_URL` set by the compose service.\n- **Passing flags through compose.** The README documents `docker compose run --rm loadtest python /app/loadtest/load_test.py --messages 2000`. That is right if the service uses `command`; if it uses `entrypoint`, that line needs changing.\n\n### Contract gaps (I implemented the contract as written)\n1. **`Idempotency-Key` on `POST /v1/messages/batch`.** The header and its semantics are documented only under `POST /v1/messages`. The script relies on it for batches; if the gateway ignores it there, a retried batch would be accepted and charged twice.\n2. **Same key while the first request is still in flight.** The behaviour is unspecified (block, 409, or a second insert). It matters when the client times out at 60 s and retries.\n3. **No per-attempt timestamps in the tenant API.** `<Message>` has only `attempts` and `submitted_at`. The \"gateway view\" rate is therefore `sum(attempts) / (last submitted_at - first submitted_at)`, which is approximate. The carrier's `/stats` is the direct measurement and is printed next to it.\n4. **`GET /v1/messages` has no `client_ref` prefix filter**, and stats have no run or time filter. The script filters by `created_from` (run start minus a 60 s clock-skew allowance) plus a client-side prefix match, and detects completion from stats deltas. This assumes the tenants are otherwise idle.\n5. **`created_from` format.** The contract says only \"ISO 8601\". The script sends `2026-11-24T15:04:05.123456Z`; the gateway must accept the `Z` suffix with microseconds.\n6. **`events` always containing an `ACCEPTED` row** is not stated. The script uses the ACCEPTED event and falls back to `created_at` if it is missing.\n7. **Carrier `/stats` does not expose the configured rate limit**, so 50 is a constant in the script. It is also not stated whether `max_submits_in_one_second` counts received or accepted submits.\n8. **`POST /reset` response shape** is not specified. The script only checks for a 2xx.\n9. **Refund policy.** The contract does not say that exactly the FAILED messages are refunded. Check (c) assumes UNDELIVERED and EXPIRED stay charged, as the task specified; a gateway that refunds those would fail \"no refund on a message that is not FAILED\".\n10. **Tenant label.** The report uses the `tenant` slug from `GET /v1/balance` (\"shopfast\", \"acme-bank\") because the tenant API does not return the display name."
]
```

### findings

```json
[
  {
    "title": "Overview's 15 s poll never fires while the stream is live, so the Billing and Webhooks tiles freeze",
    "file": "C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\lib\\api\\hooks.ts (useOverview) + C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\lib\\live\\live-provider.tsx (stats handler)",
    "severity": "high",
    "problem": "useOverview relies on `refetchInterval: 15_000` to refresh `webhooks`, `billing` and `carrier`, which are not in the stream. But LiveProvider calls `queryClient.setQueryData(queryKeys.overview, ...)` on every `stats` event (once a second). In @tanstack/query-core 5.108.4 every query update runs `QueryObserver.onQueryUpdate -> #updateTimers -> #updateRefetchInterval`, which clears and re-creates the setInterval. An interval that is restarted every 1 s never reaches 15 s. Each setQueryData also sets `dataUpdatedAt = now`, so the query is never stale and neither window focus nor a remount (staleTime 5 s) refetches it. Verified with a script against the installed query-core: refetchInterval 150 ms gives 10 fetches in 1.5 s; with setQueryData every 100 ms it gives 1 (the initial one). Result: while the indicator says Live, 'Webhooks pending / delivered / dead' and the 'Ledger consistent / charged twice' alert show the values from page load until the stream reconnects. The code comment in useOverview claims the opposite.",
    "fix": "Stop writing stream data into the query that needs polling. Keep the REST `overview` query untouched by stats events (so its interval and staleness work) and put the live part (`queue`, `throughput`) in its own cache entry, e.g. `['overview','live']`, seeded from the REST response and patched by `applyStatsToOverview`; StatTiles/ThroughputChart read queue+throughput from the live entry and webhooks/billing/carrier from the REST one. Minimal alternative: drop `refetchInterval` on useOverview and run an explicit `setInterval(() => queryClient.refetchQueries({ queryKey: queryKeys.overview }), 15_000)` in an effect (the existing `second < lastSecond` guard already handles the refetch racing a stats event)."
  },
  {
    "title": "Message list: one React render per stream event, and an unbounded pending map that is copied and re-parsed on every event",
    "file": "C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\components\\messages\\use-message-list.ts (updatePending, message handler) + live-list.ts (trackMessage, pendingCount)",
    "severity": "high",
    "problem": "(1) `updatePending` always returns a new `{ listId, value }` object, even when `trackMessage`/`trackBatch` return the same `pending` (the common case: message of an already counted batch, older message, filter mismatch). React cannot bail out, so MessagesView (filter bar, `flatMap` of all pages, the whole table element list) re-renders for every `message` event that is not a loaded row, i.e. almost all of them at 200 events/s. (2) `pending.messages` has no cap: every new non-batch message that matches the filters adds an entry, and each insert does `new Map(pending.messages)` (O(n) copy). (3) `pendingCount` runs on every render and, per entry, calls `isNewerThanLoaded` which runs two regex + two `Date.parse` calls (`epochMicros` of the entry and of the newest loaded row again). With the page left open on a steady single-message stream the map grows without bound and each event costs O(n): at ~10k entries that is roughly 10 ms per render times up to 200 renders/s, which saturates the main thread. Loaded-row patches (`setQueryData` per event) are also unthrottled.",
    "fix": "In `updatePending` return `previous` when nothing changed: `const current = previous.listId === listId ? previous.value : NOTHING_PENDING; const next = update(current); return next === current && previous.listId === listId ? previous : { listId, value: next };`. Buffer stream events in a ref and flush once per animation frame (one `setQueryData` + one `setPending` per frame). Cap the pending set (e.g. stop tracking IDs at 1,000 and render '1,000+ new messages'), store `createdAt` as a precomputed number (epochMicros once at insert), and compute the newest loaded timestamp once per `pendingCount` call instead of once per entry."
  },
  {
    "title": "Live row patches are overwritten when a list fetch is in flight (Load more / refetch), leaving rows on a stale status",
    "file": "C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\components\\messages\\use-message-list.ts",
    "severity": "medium",
    "problem": "The `message` handler patches the cache with `setQueryData(queryKey, patchLoaded(...))` regardless of whether the infinite query is fetching. TanStack's `infiniteQueryBehavior.onFetch` captures `oldPages = context.state.data?.pages` when the fetch starts and writes `[...oldPages, newPage]` when it ends, so every patch applied while `fetchNextPage` is in flight is discarded. A full refetch (focus, post-send invalidation, reconnect) has the same effect: page 1 is read first, later pages are fetched sequentially, and the whole result replaces the cache, so any event applied meanwhile is replaced by an older DB snapshot. Verified with a script against the installed query-core: row patched to DELIVERED during a pending fetchNextPage is QUEUED again after it settles. Because a final status produces no further event, the row then shows e.g. SUBMITTED until a manual refresh. At 200 events/s a 50-100 ms Load more loses 10-20 events.",
    "fix": "Do not apply events straight into a cache that is being fetched. Either buffer events while `queryClient.isFetching({ queryKey }) > 0` and re-apply the buffer with `patchLoaded` when the fetch settles (it is rank-guarded, so re-applying is safe), or keep a small bounded `Map<id, Message>` of the latest event per message and merge it over the pages in the query's `select` (dropping an entry once the fetched row has an equal or higher `statusRank`)."
  },
  {
    "title": "Idempotency key is dropped on success, so a second click or held Enter after a fast 202 sends and charges a second message",
    "file": "C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\components\\send\\use-send-message.ts (onSuccess) + send-view.tsx (submit guard, button disabled state)",
    "severity": "medium",
    "problem": "The only guards are `send.isPending` (submit early-return and `disabled`) and the key kept in `unconfirmed`. `onSuccess` sets `unconfirmed.current = null`, and the form keeps its values. On a local gateway the POST returns in tens of milliseconds, which is shorter than a double-click interval or keyboard auto-repeat of Enter: click 1 succeeds, the button is enabled again, click 2 passes the guard, `mutationFn` sees no stored fingerprint, generates a new key, and the gateway accepts and charges an identical second message. The key therefore protects retries after a failure and truly concurrent submits, but not the most common accidental double send.",
    "fix": "Keep the key bound to the draft, not to the outcome: do not clear `unconfirmed` in `onSuccess`, so an unchanged draft re-submits with the same key and the gateway replays the stored response (`Idempotent-Replay: true`, no new message, no charge). Mint a new key only when the fingerprint changes or the user explicitly chooses 'Send again' (a button on the result card that clears the ref), and in `submit` ignore a submit while a result for the same fingerprint is showing."
  },
  {
    "title": "Message detail goes stale while live: retries, webhook results and extra DLRs change without a `message` event and nothing else refetches",
    "file": "C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\lib\\api\\hooks.ts (useMessageDetail) + C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\components\\message-detail\\message-detail-view.tsx",
    "severity": "medium",
    "problem": "While the stream is live `useMessageDetail` has `refetchInterval: false` and is only invalidated by a `message` event for that id. The gateway publishes `message` events only for status transitions: a retried submit publishes nothing (dispatch.py, `Action.RETRY` -> `changes = []`), webhooks.py never publishes, and duplicate/ignored DLRs produce no change. The webhook delivery row is created in the same transaction as the final status, so the refetch triggered by the DELIVERED event always reads the webhook as PENDING, and its later DELIVERED/DEAD result, `attempts` and `last_http_status` never appear. Likewise a message that is retrying (RATE_LIMITED / UNAVAILABLE / TIMEOUT attempts) shows no new attempt rows, and the 10% duplicate DLRs never show up, until the tab is refocused after 5 s or the page is reloaded.",
    "fix": "Poll the detail while it still has open sub-records, independent of the stream: `refetchInterval: (query) => { const d = query.state.data; const open = !d || d.webhooks.some(w => w.status === 'PENDING') || d.attempts.some(a => a.outcome === null) || !d.message.finalized_at || (d.message.finalized_at && d.webhooks.length === 0 && false); return open ? 2_000 : fallback; }` (i.e. 2 s while the message is not final or a webhook is PENDING or an attempt is in flight, otherwise the existing fallback). Keep the event-driven invalidation for immediacy."
  },
  {
    "title": "Turning 'Live updates' off and on again leaves rows on the status they had when it was switched off",
    "file": "C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\components\\messages\\use-message-list.ts",
    "severity": "low",
    "problem": "`useLiveEvent(..., live)` simply unsubscribes while `live` is false. Events that arrive in that time are dropped, and switching `live` back on does not refetch. A row that went SUBMITTED -> DELIVERED while the switch was off gets no further event (the status is final), so it stays SUBMITTED, and messages created meanwhile are not counted in the 'N new messages' pill. The list looks live but is not consistent with the gateway.",
    "fix": "When `live` changes from false to true, treat it like a stream gap: `void queryClient.invalidateQueries({ queryKey })` (or call `query.refetch()`) in an effect keyed on `live`, before events are applied again."
  },
  {
    "title": "No refetch after the first stream open, so events between the initial REST snapshot and the SSE subscription are lost",
    "file": "C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\lib\\live\\connection.ts (onopen / missedEvents)",
    "severity": "low",
    "problem": "`onGapClosed` only runs when `missedEvents` is true, and it starts as false. On page load the queries are issued in child effects before `LiveProvider`'s effect calls `connection.start()`, and nothing orders the REST snapshot against the moment the gateway registers the SSE client. Any status change that commits after the list/detail SQL ran but before the subscription exists is in neither the snapshot nor the stream. Under load a loaded row that reaches its final status in that window stays on the earlier status, since no later event corrects it. The reconnect path handles exactly this case; the first connect does not.",
    "fix": "Initialise `private missedEvents = true` (and set it back to true in `stop()`), so the first `onopen` also calls `onGapClosed()` and the active queries are refetched once the subscription is known to exist."
  },
  {
    "title": "Result card misses the QUEUED event and can show 'Accepted' for as long as the message waits in the queue",
    "file": "C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\components\\send\\result-card.tsx",
    "severity": "low",
    "problem": "The card starts from `message.status` of the 202 body, which is always `ACCEPTED`, and subscribes to the stream only after it mounts. The gateway publishes the message's `QUEUED` event inside the request, before it writes the HTTP response (`await publisher.publish_all(...)` then `accept_response`), so that event reaches the browser before the card exists and is never seen. The card therefore shows Accepted while the message is QUEUED, until the SUBMITTED event; with a deep queue that is minutes, and if the stream is not live it never changes at all.",
    "fix": "Do not depend on catching every event from mount: in ResultCard also read the message once and on reconnect, e.g. `const detail = useMessageDetail(message.id)` and show the status with the highest `statusRank` of `message.status`, the last stream event and `detail.data?.message.status` (useMessageDetail already falls back to 15 s polling when the stream is not live)."
  },
  {
    "title": "A failed background refetch replaces loaded content: the send form unmounts mid-entry and the overview flips to error cards",
    "file": "C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\components\\send\\send-view.tsx",
    "severity": "high",
    "problem": "send-view.tsx line 198 renders `tenants.isError ? <ErrorState>` without checking `tenants.data`. In TanStack Query v5 a failed refetch sets status to \"error\" while keeping data (verified in node_modules/@tanstack/query-core query.js, case \"error\"). useTenants polls every 15 s whenever the stream is not live, so when the gateway goes down the whole <form> (focused field, failure alert, submit button) is replaced by an error card within 15 s. That contradicts the alert the form has just shown (\"You can send again. The same idempotency key is reused\"): the Send button is gone. The same pattern is in overview/stat-tiles.tsx line 115, overview/pipeline-strip.tsx line 59, overview/tenant-cards.tsx line 85 and overview/throughput-chart.tsx line 170: last known numbers disappear at the moment of an incident, and while the stream is live a single failed 15 s overview poll shows the error card (role=\"alert\") until the next \"stats\" event calls setQueryData (which resets status to success, up to 1 s later), so tiles and chart flash error/content. messages-view.tsx already does it right (`query.isError && !query.data`).",
    "fix": "In all five places branch on `query.isError && !query.data` for the full error state. When `isError && data`, keep rendering the content and add a one-line inline notice (\"Could not refresh, showing data from HH:mm:ss\" using `query.dataUpdatedAt`, plus Retry). In send-view.tsx keep the form mounted and only show the notice above it."
  },
  {
    "title": "Message list does not refresh while the stream is down, but the header says data refreshes every 15 seconds",
    "file": "C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\components\\messages\\use-message-list.ts",
    "severity": "high",
    "problem": "useMessageList's useInfiniteQuery has no refetchInterval (the only three refetchInterval uses are in lib/api/hooks.ts for tenants, overview and message detail). When the stream is \"connecting\" or \"reconnecting\", rows stop changing status and the \"N new messages\" pill stops counting, yet connection-indicator.tsx tells the operator \"Data refreshes every 15 seconds until it is back\" and the \"Live updates\" switch still shows on. During a stream outage with a healthy REST API the operator reads a frozen list as current.",
    "fix": "In use-message-list.ts read `useConnectionState()` and pass `refetchInterval: live && state !== \"live\" ? 15_000 : false` (the query already refetches all loaded pages). Also show the state next to the switch in messages-view.tsx, for example \"Live updates (stream down, polling every 15 s)\", so the switch never claims live while the stream is not."
  },
  {
    "title": "Message detail shows stale data with no notice when a refresh fails",
    "file": "C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\components\\message-detail\\message-detail-view.tsx",
    "severity": "medium",
    "problem": "Line 178 handles only `query.isError && !query.data`; in every other error case line 209 renders `<Loaded detail={query.data} />` unchanged. If the gateway goes down (or the refetch triggered by a stream event fails) the page keeps showing the old status badge and timeline with no error text, no retry and no \"as of\" time. The only hint is the small \"Reconnecting\" label in the header. An operator watching one message during an incident cannot tell that SUBMITTED on screen may be minutes old.",
    "fix": "When `query.isError && query.data`, render an `<Alert tone=\"warn\" role=\"alert\">` above the header: \"Could not refresh this message. Showing data from {format(query.dataUpdatedAt)}. {describeError(query.error)}\" with a Retry button calling `query.refetch()`."
  },
  {
    "title": "Timestamps never state a time zone, and the history shows time of day without a date",
    "file": "C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\lib\\format.ts",
    "severity": "medium",
    "problem": "The API is UTC (docs/API.md, Conventions), gateway logs are UTC, but formatDateTime (\"yyyy-MM-dd HH:mm:ss.SSS\") and formatClock (\"HH:mm:ss\") print browser-local time with no zone. Affected: the detail header \"created ...\", the DLR \"carrier time\", the throughput chart axis and tooltip, the list tooltip, and the datetime-local From/To filters in messages/filter-bar.tsx (also local, unlabeled; their visible labels \"From\" and \"To\" are the same words as the sender and destination column headers below). message-detail/timeline.tsx Clock prints only \"HH:mm:ss.SSS\": a message accepted at 23:59 and expired the next day, or a webhook retry hours later, shows no date except in a hover-only `title`. In the list the Time column is relative only (\"42s ago\", recomputed every 10 s by useNow(10_000), so it can be 10 s off); the absolute time is in a Tooltip that is not `focusable`, so it is unreachable by keyboard, and on touch the tap navigates away (row onClick).",
    "fix": "Add the offset to the formatters: `format(date, \"yyyy-MM-dd HH:mm:ss.SSS xxx\")` (or render UTC consistently and label it \"UTC\"). In Clock, print the date when it differs from the previous item's day and drop the `title`-only fallback. Label the filters \"Created from (local time)\" / \"Created to\". Label the chart description \"local time, UTC+hh:mm\". In message-row.tsx show the absolute clock time as text under or beside the age instead of only in a hover tooltip."
  },
  {
    "title": "Table rows are click handlers on <tr>, not links: 50+ tab stops, no link semantics, no new-tab, and taps on in-row tooltips navigate away",
    "file": "C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\components\\messages\\message-row.tsx",
    "severity": "medium",
    "problem": "Each row is `<tr tabIndex={0} onClick onKeyDown aria-label=...>` (lines 60-67). (1) There is no <a>, so no middle-click, no context-menu \"open in new tab\", no status-bar URL, and a screen reader announces a row with a custom name and no interactive role. (2) Every row is a tab stop: with the default page of 50 rows a keyboard user must press Tab 50+ times (more with each ambiguous-attempt icon, which is a second tab stop inside the row) to get from the filters to \"Load more\"; after three pages it is 150+. (3) The aria-label replaces the row content when the row is focused, so tenant, time and cost are not read. (4) handleClick does not check the event target, so tapping the focusable warning-icon tooltip (line 89) on a touch screen opens the detail page instead of showing the hint.",
    "fix": "Put a real `<Link href={`/messages/${message.id}`}>` in the first cell (the time/age, or a short message ID) and remove tabIndex, onKeyDown and aria-label from the <tr>. Keep the row onClick only as a mouse convenience and return early when `(event.target as Element).closest(\"a,button,[tabindex]\")` matches. To cut tab stops, add a visually hidden \"Skip to end of table\" link before the table that targets the footer, or use a roving tabindex with ArrowUp/ArrowDown across the row links."
  },
  {
    "title": "Live regions announce on every stream event: new-message pill, the tenant balance hint and the whole result card",
    "file": "C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\components\\ui\\field.tsx",
    "severity": "medium",
    "problem": "Three polite live regions change far more often than a screen reader can speak. (1) field.tsx line 67 puts `aria-live=\"polite\"` on every field's message line, including hints. The Tenant field's hint in send/send-view.tsx is the live balance, which the \"stats\" event rewrites every second while messages are being charged, so \"Balance $249.9960\" is announced repeatedly while the user fills the form. (2) messages/messages-view.tsx line 83 wraps the \"N new messages\" pill in `aria-live=\"polite\"`; the count changes on every message/batch event, so under load it queues an announcement per event. (3) send/result-card.tsx line 32 gives the whole section `role=\"status\"`, which is atomic by default, so each status change (ACCEPTED, QUEUED, SUBMITTED, DELIVERED) re-reads the full card including the 36-character message ID.",
    "fix": "field.tsx: render the hint without aria-live and add `role=\"alert\"` (or aria-live) only when `error` is set. messages-view.tsx: remove aria-live from the pill wrapper and add a separate sr-only `role=\"status\"` element whose text changes only when the count goes from 0 to more than 0 (\"New messages available\"). result-card.tsx: drop role/aria-live from the section and put `aria-live=\"polite\"` only on the <dd> that holds the StatusBadge."
  },
  {
    "title": "Send form: focus is lost or left behind after submit",
    "file": "C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\components\\send\\send-view.tsx",
    "severity": "medium",
    "problem": "Client-side validation focuses the first invalid field (line 143), but the server path does nothing with focus. (1) The submit button gets the native `disabled` attribute while pending (line 313). If it was activated with the keyboard, the focused element becomes disabled, the browser moves focus to <body>, and it is not restored when the request ends. The same happens with \"Refresh\" (`disabled={query.isFetching}`) and \"Load more\" in messages/messages-view.tsx. (2) When the gateway answers 422 with `details`, showFailure sets aria-invalid on the fields but does not focus the first one, and the alert is rendered below the last field. (3) On success the ResultCard is inserted below the form and focus stays where it was; the fields keep their values and the only confirmation near the keyboard position is a toast in the opposite corner.",
    "fix": "Replace `disabled` for the pending case with `aria-disabled={send.isPending}` (submit already returns early when `send.isPending`); keep `disabled` only for `unsupported`. Do the same for Refresh and Load more. In showFailure, after setting state, focus the first field in FIELDS that has a server error, else focus the alert container (give it `tabIndex={-1}` and a ref). In onSuccess, move focus to the ResultCard (ref on its \"Open message\" link or a `tabIndex={-1}` heading)."
  },
  {
    "title": "Control borders, the off switch and the current nav item fail 3:1 non-text contrast in both themes; mobile nav focus ring is clipped",
    "file": "C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\app\\globals.css",
    "severity": "medium",
    "problem": "Computed from the tokens (WCAG relative luminance). All text pairs pass 4.5:1, but these UI boundaries do not reach 3:1 (WCAG 1.4.11): (1) `.control` and secondary buttons use `border-line-strong`: #d1d1d6 on #ffffff = 1.52:1 light, #36363d on #131316 = 1.55:1 dark. The border is the only thing that marks an input on the card. (2) ui/switch.tsx off state: track `bg-line-strong` on the canvas = 1.42:1 light / 1.64:1 dark, knob on track = 1.52:1 / 1.55:1, so the off position of \"Live updates\" is close to invisible. (3) layout/navigation.tsx marks the current page only with `bg-raised` and ink text: raised on surface = 1.13:1 (light sidebar), raised on canvas = 1.05:1 (mobile bar), dark 1.08:1 / 1.15:1; ink versus muted text is 2.40:1 (light) and 2.14:1 (dark). The current page is carried by a colour difference alone and a faint one. Separately, the horizontal nav <ul> has `overflow-x-auto` with no padding, so the global 2 px outline at 2 px offset is clipped above, below and left of the first link under 768 px (which is also the layout a desktop user gets at 200% zoom).",
    "fix": "Add a control border token with at least 3:1, for example `--control-border: #8a8a94` (3.42:1 on white, 3.19:1 on canvas) and dark `#6b6b76` (3.52:1 on surface), and use it in `.control`, the range group and secondary buttons. Switch off track: `bg-ink-faint` (5.07:1 light, 5.83:1 dark, knob 5.4:1). Nav current item: add a non-colour mark such as `shadow-[inset_2px_0_0_var(--ink)]` in the sidebar and an underline or `font-semibold` in the horizontal bar. Give the horizontal <ul> `p-1 -m-1` (or use `focus-visible:-outline-offset-2` on the links) so the ring is not clipped."
  },
  {
    "title": "On phones the Status column of the message table is off-screen and the table scrolls inside a short nested box",
    "file": "C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\components\\messages\\messages-table.tsx",
    "severity": "medium",
    "problem": "The table keeps all nine nowrap columns at every width. Column order is Time, Tenant, To, From, Status... With px-3 cells and a monospace 14-character number, Status starts at roughly 400 px (Time about 74, Tenant about 94, To about 142, From about 91), while the scroll container on a 375 px phone is 341 px wide. The one column an on-call operator needs is not visible without horizontal scrolling, and no column is sticky, so after scrolling right the row loses its time and number. The container is also `max-h-[calc(100dvh-19rem)] min-h-80`: the 19rem allowance matches the desktop chrome, but under 768 px the header is two rows and the filter bar wraps to about six rows, so the table becomes a 320 to 360 px box that must itself be scrolled inside the page scroll.",
    "fix": "Under `md`, hide Tenant, From, Encoding and Segments (`hidden md:table-cell` on the Th and Td) and move Status directly after Time, or render each message as a two-line stacked row. Drop the max-height under `md` (`md:max-h-[calc(100dvh-19rem)]`) so the page scrolls once and the sticky header is only used from 768 px up."
  },
  {
    "title": "Pipeline strip truncates status names and descriptions on narrow screens, with a hover-only title as the fallback",
    "file": "C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\components\\overview\\pipeline-strip.tsx",
    "severity": "low",
    "problem": "Below the @4xl container width the first line still holds ACCEPTED, arrow, QUEUED/FAILED, arrow, SUBMITTED side by side with `flex-1 min-w-0`. At a 375 px viewport the card's inner width is 309 px, which leaves about 82 px per stage (60 px of content), and the FAILED stage, which also shares its line with a 16 px corner icon, gets about 60 px (38 px of content, about 24 px for the label after the dot). By the class arithmetic \"Failed\", \"Accepted\", \"Submitted\" and \"Undelivered\" are cut by `truncate`, and a four-digit FAILED count in 18 px monospace (about 54 px) is wider than its 38 px content box and has no overflow handling. The description line is truncated on phones and also in the single-row layout around 1280 px, and its full text is only in a `title` attribute, which keyboard and touch users cannot reach. The comment says this strip \"is also the legend for the status colours\".",
    "fix": "Under @4xl use a grid instead of the flex row: `grid grid-cols-2 gap-2` with FAILED as its own full cell (drop the horizontal arrows there, keep the order ACCEPTED, QUEUED, FAILED, SUBMITTED, then the three final states). Remove `truncate` from the label, let the description wrap (`line-clamp-2`) instead of relying on `title`, and add `min-w-0 truncate` or a smaller size step to the count so it cannot leave its box."
  },
  {
    "title": "Loading states are silent to screen readers and /messages has no fallback before hydration",
    "file": "C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\components\\overview\\stat-tiles.tsx",
    "severity": "low",
    "problem": "The loading containers put `aria-label` on a plain <div> with no role (stat-tiles.tsx line 104, overview/tenant-cards.tsx line 78, message-detail/message-detail-view.tsx line 148, send/send-view.tsx line 61). aria-label is not exposed on a generic element, and every Skeleton is aria-hidden, so assistive technology gets nothing while data loads (on the detail and send pages the region is simply empty). Separately, app/(console)/messages/page.tsx wraps MessagesView in `<Suspense>` with no fallback; because the filters come from the URL on the client the prerendered HTML has an empty <main> until JavaScript runs, so the first paint of the Messages page is blank instead of a skeleton shaped like the table.",
    "fix": "Give each loading container `role=\"status\"` and a visually hidden text child (\"Loading tenants…\") instead of aria-label on a role-less div. In messages/page.tsx pass a fallback that renders the PageHeader, a filter-bar placeholder and `<MessagesTable messages={[]} loading />`."
  },
  {
    "title": "Overview heading outline is wrong: tile and tenant headings are h3 under unrelated h2s",
    "file": "C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\components\\overview\\tenant-cards.tsx",
    "severity": "low",
    "problem": "CardHeader renders h2 (\"Pipeline\", \"Carrier throughput\"). The stat tiles (overview/stat-tiles.tsx line 33: \"Queue depth\", \"Oldest queued\", \"In flight\", \"Webhooks pending\", \"Billing\") and the tenant names (tenant-cards.tsx line 17) are h3 with no h2 of their own. In a screen reader's heading list the queue and billing tiles are children of \"Pipeline\" and the tenants are children of \"Carrier throughput\". There is no heading that names the tenant region at all, and the send form card on /send has no heading either (only the Preview card does).",
    "fix": "Wrap the tiles in a `<section aria-labelledby>` with a visually hidden `<h2>Queue, webhooks and billing</h2>`, and add an `<h2 className=\"sr-only\">Tenants</h2>` (or a visible CardHeader-style title) before the tenant cards, keeping tiles and tenant names as h3 under them. Add `<CardHeader title=\"Message\" />` to the form card in send/send-view.tsx."
  }
]
```

### fixReport

```text
All 20 findings were real and are fixed; none rejected. All four checks pass. Work stayed inside `C:\Users\Ico\Desktop\Ico\Work\Digi Comm\dashboard`; no git commands were run.

## Findings

1. **Overview poll never fires while live** — fixed. Stats events no longer write into the overview query. Queue and throughput are kept beside the cache (`src/lib/live/live-overview.ts`, state in `LiveProvider`) and merged in `useOverview` via `select`; they are dropped when the stream is not live.
2. **One render per event, unbounded pending map** — fixed. Events go into a bounded buffer (`src/components/messages/event-buffer.ts`, 5,000 messages, overflow triggers a refetch) and are applied every 100 ms. I used a timer rather than an animation frame, because frames stop in a hidden tab and events would pile up. `updatePending` returns the same object when nothing changed. Tracking is capped at 1,000 messages and 1,000 batches, shown as "1,000+ new messages". Creation times are stored as numbers, and entries a refetch has loaded are dropped.
3. **Row patches overwritten during a fetch** — fixed. The buffer is not applied while the list query is fetching, and is applied once it settles.
4. **Idempotency key dropped on success** — fixed. The key stays bound to the draft, and the form ignores a submit while that draft's result is showing. The result card has a "Clear result" button that drops the key and focuses Send. I chose a two-step button over a one-click "Send again", because a double click on that would itself send twice.
5. **Detail goes stale while live** — fixed. `useMessageDetail` polls every 2 s while the message is not final, an attempt is in flight or a webhook is pending. Otherwise it polls every 15 s regardless of the stream, which also picks up late duplicate DLRs.
6. **Live updates off then on leaves stale rows** — fixed. Switching it back on invalidates the list. The `live` state moved into `useMessageList`.
7. **No refetch after the first stream open** — fixed. `onGapClosed` now runs on every open. The `missedEvents` flag was always true at that point, so I removed it.
8. **Result card misses QUEUED** — fixed. The card reads its status from `useMessageDetail`, which now owns the event-driven refetch for both the card and the detail page.
9. **Failed refetch replaces loaded content** — fixed. All five places now show the error state only when there is no data (`isLoadingError`). A new `RefreshFailedNotice` in `ui/states.tsx` gives the data's timestamp, the error and a Retry. On the overview it is one notice per query at the top of the page rather than one per region; the send form stays mounted with the notice above it.
10. **List frozen while the stream is down** — fixed. The list polls every 15 s when live updates are on and the stream is not live, and the header says so next to the switch.
11. **Detail stale with no notice** — fixed with the same `RefreshFailedNotice` above the header.
12. **Timestamps without zone or date** — fixed. I kept local time and added the offset rather than switching to UTC.
    - `formatDateTime` prints the offset, e.g. `2026-11-24 23:04:05.123 +08:00`.
    - Timeline clocks print the date on the first entry and whenever the day changes; the `title`-only fallback is gone.
    - The History card and the chart name the zone ("UTC+08:00").
    - Filters are labelled "Created from (local time)" / "Created to".
    - List rows show the clock time as text plus the age, and the column header is "Time (local)".
13. **Rows are click handlers, not links** — fixed. The first cell holds a real `<Link>`; `tabIndex`, `onKeyDown` and `aria-label` are gone from the `<tr>`. The row click remains as a mouse convenience and ignores clicks on links, buttons and focusable elements. A "Skip to the end of the table" link targets the footer.
14. **Live regions announce on every event** — fixed. Field hints are no longer live; only errors are (`role="alert"`). The pill has a separate hidden status whose text changes only when new messages first appear. The result card announces only its status cell.
15. **Focus lost after submit** — fixed. `Button` treats `aria-disabled` as focusable but inactive; Send, Refresh and Load more use it for the pending state. A gateway 422 focuses the first rejected field, otherwise the failure alert. On success focus moves to the result card heading.
16. **Non-text contrast, clipped nav ring** — fixed. New `--control-border` token is used on inputs, the range group and secondary buttons. The off switch track uses `ink-faint`. The current nav item gets an ink bar. The horizontal nav has padding so the focus ring is not clipped. Recomputed ratios:

    | Pair | Light | Dark |
    |---|---|---|
    | Control border on surface | 3.42 | 3.52 |
    | Control border on canvas | 3.19 | 3.74 |
    | Control border on raised | 3.03 | 3.26 |
    | Off switch track on canvas | 5.07 | 5.83 |

17. **Phone table layout** — fixed. Status now comes right after Time at all widths. Tenant, From, Encoding and Segments are hidden below 768 px, cell padding is tighter there, and the max-height only applies from 768 px up.
18. **Pipeline strip truncation** — fixed. It is now one CSS grid: two columns when narrow, the flow with arrows when wide. Labels and descriptions wrap, and a long count wraps rather than overflowing or being cut.
19. **Silent loading states, no Messages fallback** — fixed. A `LoadingLabel` (hidden `role="status"` text) is in the four loading regions. `/messages` has a Suspense fallback (`messages-fallback.tsx`) with the header, a filter placeholder and the table skeleton.
20. **Heading outline** — fixed. The tiles sit under a hidden h2 "Queue, webhooks and billing", the tenant cards under a hidden h2 "Tenants", the form card has a "Message" header, and the result card heading is an h2.

## Changes beyond the findings

- `patchLoaded` now patches a row only when the event moves it to a later status (it was "not earlier"). Otherwise re-applying a buffered event after a fetch could overwrite a newer row of the same status.
- `dashboard/README.md` is updated for the changed live-update and idempotency behaviour.
- `formatAge` returns null from one day on; the row shows the date instead.

## Checks

- `npm run lint`: passed, no output from `eslint .`
- `npm run typecheck`: passed, no output from `tsc --noEmit`
- `npm run test`: `Test Files 9 passed (9)`, `Tests 183 passed (183)`
- `npm run build`: compiled successfully, 6/6 static pages generated (`/`, `/messages`, `/send` static; `/messages/[id]` and the proxy dynamic)
- `npx prettier --check .`: all files pass

## Verified by running it

I ran the production build against a throwaway mock of the internal API and stream (in the scratchpad, not in the repo) and checked in the browser pane:

- **1:** three overview requests in 46 s while the stream was live; tenants were not polled.
- **2 and 3:** two "Load more" clicks with a 2.5 s list delay at about 20 new messages a second left 0 of 150 rows behind the gateway. A burst of 200 a second showed "1,000+ new messages", and the pill reloaded to a fresh first page.
- **4:** three rapid clicks on Send produced exactly one POST and one message. "Clear result" then Send produced a new message.
- **6:** rows were frozen while off and matched the gateway after switching back on.
- **8:** the result card showed Queued, then Delivered.
- **9, 10, 11:** with REST failing, the send form stayed mounted with the notice, the overview kept its numbers with a steady notice, and the detail page showed its notice. With the stream down, the list polled every 15 s and said so.
- **12, 17, 18, 20:** checked at 375 px and 1440 px in dark, and the Messages page in light. On a phone, Time, Status and To fit without sideways scrolling.
- **13:** no tab stops on rows, 50 row links, skip link present.
- **15:** a 422 focused the From field; success focused the result heading.
- **19:** the prerendered `/messages` HTML contains the fallback.

## Not verified

- Nothing was run against the real gateway (no Docker on this machine); the mock follows `docs/API.md`.
- No screen reader was used. The live-region and focus changes were checked through DOM attributes and `document.activeElement` only.
- The render-rate improvement in finding 2 was not measured with a profiler.
- Only Chromium was tested.

## Contract

No problems found in `docs/API.md`.
```
