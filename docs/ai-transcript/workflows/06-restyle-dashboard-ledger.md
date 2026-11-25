# Workflow 6: restyle-dashboard-ledger

A workflow is a script that the main session wrote to run several sub-agents. The script below holds every prompt the sub-agents received. [Back to the index](../README.md).

| | |
|---|---|
| Started | 2026-11-25 00:51 (UTC+8) |
| Duration | 69.2 minutes |
| Sub-agents | 7 |
| Tool calls by sub-agents | 674 |
| Status | completed |
| Default model | claude-fable-5-2 |
| Run id | wf_26b88c85-96c |

## Phases

- **Foundation** (model: opus): tokens, fonts, shell and shared primitives
- **Pages** (model: opus): overview, messages + detail, send test, in parallel
- **Critique** (model: opus): two critics compare real screenshots with the mock-ups
- **Polish** (model: opus): fix every finding, run all checks, take the final screenshots

## Summary

Restyle the dashboard as "Ledger, in colour": foundation, three page builders in parallel, two screenshot critics, then a polish pass

## Log lines

```text
critique: 28 findings
```

## Script

```js
export const meta = {
  name: 'restyle-dashboard-ledger',
  description: 'Restyle the dashboard as "Ledger, in colour": foundation, three page builders in parallel, two screenshot critics, then a polish pass',
  phases: [
    { title: 'Foundation', detail: 'tokens, fonts, shell and shared primitives', model: 'opus' },
    { title: 'Pages', detail: 'overview, messages + detail, send test, in parallel', model: 'opus' },
    { title: 'Critique', detail: 'two critics compare real screenshots with the mock-ups', model: 'opus' },
    { title: 'Polish', detail: 'fix every finding, run all checks, take the final screenshots', model: 'opus' },
  ],
}

const ROOT = 'C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm'
const DASH = `${ROOT}\\dashboard`
const D = 'C:\\Users\\Ico\\AppData\\Local\\Temp\\claude\\0aaf5675402adb95\\e1bcbcbb-6672-4634-a789-27e2e0879529\\scratchpad\\design'
const SHOTS = 'C:\\Users\\Ico\\AppData\\Local\\Temp\\claude\\0aaf5675402adb95\\e1bcbcbb-6672-4634-a789-27e2e0879529\\scratchpad\\shots'

const COMMON = `
You are a senior frontend engineer with a designer's eye, restyling an internal operations console for an SMS gateway. The owner called the current UI "AI slop" and asked for a premium, aesthetic look with good colour. A direction has been chosen and specified.

READ FIRST, fully, before writing anything:
  1. ${D}\\BUILD_BRIEF.md  (the specification: what to build, the colour system, grafts, must-fix list, engineering constraints, how to take screenshots)
  2. The mock-up it names as the source of truth: ${D}\\a\\tokens.css, ${D}\\a\\app.css, the four HTML files in ${D}\\a\\ and their PNG renders (Read the PNGs: overview.png, overview-alt.png, messages.png, detail.png, send.png)
  3. ${D}\\research.md (the ban list) and ${D}\\judges.json (the must_fix and graft fields)
  4. The existing dashboard code in ${DASH}\\src (all of it; about 6,000 lines) and ${ROOT}\\docs\\API.md, section "Internal API (dashboard)".

Rules for everyone:
  - Work only inside ${DASH}. Never run a git command. Do not touch the gateway, mock-carrier or loadtest directories.
  - Behaviour must not change (see BUILD_BRIEF.md section 5). Existing tests must keep passing.
  - A dev server with hot reload is ALREADY running on http://localhost:3000 against a live gateway. Do not start another server. Do not run "npm run build" unless your task says so (several engineers share this directory).
  - Look at your work: take screenshots with the render script (BUILD_BRIEF.md section 6), Read them, and compare with the mock-up PNGs. Iterate until they match in structure, rhythm, type and alignment, with the colour system applied.
  - Code quality: small focused components, semantic HTML (real tables, buttons, labels), accessible (visible focus, aria-live where state changes, never colour alone), no dead code, no TODOs, comments only where the WHY is not obvious, plain direct English, no emojis.
  - Final answer: a short report of what you built, what you verified by looking at screenshots, what you could not do, and anything the next engineer must know.
`

const foundation = await agent(`${COMMON}
YOUR TASK: THE FOUNDATION. Everything the three page builders will share. They start only when you finish, and they are not allowed to edit your files, so make the foundation complete and obvious to use.

Build:
  1. Dependencies: add @fontsource/ibm-plex-sans and @fontsource/ibm-plex-mono (npm install); import the needed weights once in the root layout; stop using "geist" in the layout and CSS (leave removal of unused packages from package.json to the last engineer).
  2. ${DASH}\\src\\app\\globals.css: the complete token system from ${D}\\a\\tokens.css PLUS the colour system of BUILD_BRIEF.md section 2 (fill and text role per status, chart roles, time-strip roles, attention), light and dark, the dark values written ONCE and selected by [data-theme="dark"] (configure next-themes with attribute="data-theme", defaultTheme="system", enableSystem). Map tokens into Tailwind v4 with @theme inline so utilities such as text-ink, bg-paper, border-rule exist. Write a small Node script at ${DASH}\\scripts\\check-contrast.mjs that parses the token values from globals.css and prints the WCAG contrast of every text role against --paper and --paper-sunk in both themes, exits non-zero below 4.5 (5.0 for --ink-3), and add it as "npm run check:contrast". Run it and adjust the hex values until it passes.
  3. Base styles (in globals.css or a few small CSS files imported by it): the page grid with the hanging margin column, section rule, hairlines, the data table (baseline alignment, padding-based rows with --row-pad and a compact variant, sticky head, numeric columns right-aligned in tabular mono, dimmed zero cells, hover and selected row that stay inside the grid), the dotted-leader facts list, the double rule above totals, form controls (input, select, textarea, checkbox/switch, the range preset group), buttons (primary solid ink, secondary ink outline, quiet text button), links, focus ring (ultramarine, 2px, offset), the value-change flash and row-arrival fade with prefers-reduced-motion handled, and the responsive rules under 768px from the brief.
  4. Shared components in ${DASH}\\src\\components\\ui (rewrite the existing primitives in the new language, keep their exported names and props where pages already use them, and add what is missing): StatusMark and StatusWord / StatusLabel (mark shape per status as in the mock-up: circles for the carrier side, squares for ours; colour and weight per the brief; min-width 11ch), Section (margin label + optional context line + content), Figure / Money / Count (tabular mono, money to 4 decimals where compared), MessageId (bright prefix, dim rest, as a link when given an href), TimeOfDay (milliseconds dimmed), FactsList, DataTable parts, Button, Field, Select, Switch, Skeleton shaped as text lines, and the three state components (loading, empty with a next step, error with Retry) in the new language.
  5. The shell (${DASH}\\src\\components\\layout and the console layout): the masthead from the mock-up (product name "SMS Gateway" with "ops", the three nav items with the active one marked by a rule, the stream state as words: "Stream connected · last event 16:13:42 UTC" / "Reconnecting" / "Connecting", and a Light / Dark / System switch). No logo block, no sidebar, no pulsing dot. It wraps under 768px.
  6. Favicon ${DASH}\\src\\app\\icon.svg in the new language (simple, ink and one ink colour).
  7. A short ${DASH}\\src\\components\\ui\\README.md listing each primitive with a one-line usage example, so the page builders do not have to guess.

The existing pages will look half-converted when you finish; that is expected. But the app must still compile and run: "npm run lint", "npm run typecheck" and "npm run test" must pass (run them; do NOT run npm run build). Check the shell and a page in both themes with screenshots.`, { label: 'restyle:foundation', phase: 'Foundation', model: 'opus' })

const PAGE_RULES = `
The foundation is finished (tokens, base styles, shared components, shell). Its engineer's report:
${String(foundation).slice(0, 5000)}

Read ${DASH}\\src\\components\\ui\\README.md and ${DASH}\\src\\app\\globals.css before you start. You may NOT edit the foundation files (globals.css and anything in src/components/ui or src/components/layout) or another page's folder: two other engineers are building the other pages at the same time. If a shared primitive is missing something, build what you need inside your own folder and say so in your report. Run "npm run lint", "npm run typecheck" and "npm run test" before you finish (never "npm run build"). Type errors in files that are not yours are another engineer's work in progress: report them, do not fix them.`

const pages = await parallel([
  () => agent(`${COMMON}
YOUR TASK: THE OVERVIEW PAGE (${DASH}\\src\\components\\overview and src/app/(console)/page.tsx), from ${D}\\a\\overview.html and overview.png, with the colour system and these grafts from the brief: the throughput chart built like Signal's (${D}\\c\\overview.png) as hand-written SVG (stop importing recharts), the queue trend sparkline with the change over the window (a client-side ring buffer fed by the stream's stats events), dead webhooks as an action line, the ledger line with its formula, "Recent failures" (three small queries merged), derived facts ("drains in about ...", headroom), sources labelled (queue, live / records since opening balance).
The headline sentence is a pure function with the full state table from BUILD_BRIEF.md section 4 and a vitest test per state; figures inside it are tabular mono and must not make the words shift each second. The pipeline strip is the page's one large colourful object: proportional, status inks, 3px minimum segments, a fixed label row under it, expired hatched. Tenants are rows of a table with a real outcomes bar (at least 200px, 8px tall) and the delivered percentage; totals under a double rule.
To see it with traffic, run the load command from the brief in the background and take screenshots 10 to 15 seconds in, in light and dark, and at 390px width. Also screenshot the idle state.
${PAGE_RULES}`, { label: 'restyle:overview', phase: 'Pages', model: 'opus' }),
  () => agent(`${COMMON}
YOUR TASK: THE MESSAGES LIST AND THE MESSAGE DETAIL (${DASH}\\src\\components\\messages, src/components/message-detail, and the two page files under src/app/(console)/messages), from ${D}\\a\\messages.html / messages.png and ${D}\\a\\detail.html / detail.png, with the colour system and the grafts from the brief.
List: the filter row in the new language (search with "/" to focus, tenant, status, range presets next to From/To, "Following new messages" + Pause, clear filters), the table with TIME (ms dimmed), MESSAGE (ID as a link, prefix bright), TENANT, TO, FROM, TEXT (truncated, sans), STATUS (mark + word; non-delivered finals in their text role at weight 600), ENCODING, SEGMENTS, COST (4 decimals, aligned), ATTEMPTS (2+ emphasised; ambiguous flagged with a mark and an accessible explanation), FINAL IN S, date group rows, "Load 50 older", "N shown". Keep every behaviour: URL filters, cursor pagination, live row patching, the new-messages notice, loading / empty (two different texts) / error states. Under 768px the table scrolls inside a wrapper.
Detail: the headline sentence per status as a pure tested function ("Delivered to +971... in 9.17 s, on the second submit attempt."), the summary line, the "where the time went" strip on a real seconds axis in the time-strip inks, the history table (TIME UTC, SINCE ACCEPT, SOURCE, WHAT HAPPENED, DETAIL) merging status events, attempts, receipts, ledger and webhook, with gap rows ("0.303 s backoff before retry", "8.39 s with the carrier") and failed attempts in the attention colour, the facts column on the right, the message text as a quote with a left rule (not a sunk box), not-found and error states. The message with two attempts is in ${D}\\message_id.txt.
Screenshot both pages in light and dark and at 390px, plus a filtered list (status=UNDELIVERED) and an empty result (search for a number that does not exist).
${PAGE_RULES}`, { label: 'restyle:messages+detail', phase: 'Pages', model: 'opus' }),
  () => agent(`${COMMON}
YOUR TASK: THE SEND TEST PAGE (${DASH}\\src\\components\\send and src/app/(console)/send), from ${D}\\a\\send.html / send.png, with the colour system and the grafts from the brief: the headline per state as a pure tested function ("3 segments in UCS-2, 0.0120 USD." / nothing typed / invalid destination / no price for this prefix), the form in the new control language with inline validation text, the preview as a statement (encoding, units used of capacity, segments, price per segment with the matched prefix, total under a double rule, balance after), the rate card with the matched prefix row emphasised, the UCS-2 explanation naming each character with its code point and position and what the message would cost without it, the text split into its segments with a thin ink fill per segment showing units used of capacity, the button copy "Send 3 segments · $0.0120" with the consequence line ("Charged to <tenant> now. Refunded if it fails before the carrier."), server error mapping to fields, and the result of the last send (ID as a link, status following the stream, cost) drawn as a statement line, not a green card. Keep the idempotency-key behaviour exactly.
Screenshot: empty form, a GSM-7 one-segment message, the UCS-2 three-segment message from the mock-up, an invalid number, an unpriced destination (+4915112345678), after a successful send (it is a real send through the local gateway; one or two are fine), in light and dark and at 390px.
${PAGE_RULES}`, { label: 'restyle:send', phase: 'Pages', model: 'opus' }),
])

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          page: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          what: { type: 'string', description: 'what is wrong, and where exactly on the screen' },
          fix: { type: 'string' },
        },
        required: ['page', 'severity', 'what', 'fix'],
      },
    },
    verdict: { type: 'string', description: 'two sentences: does it read as a designed product, and what most holds it back' },
  },
  required: ['findings', 'verdict'],
}

const CRITIC_COMMON = `
The dashboard of an SMS gateway console has just been restyled to the specification in ${D}\\BUILD_BRIEF.md ("Ledger, in colour"). Read that brief, ${D}\\research.md and the mock-up PNGs in ${D}\\a\\ first. The real app runs at http://localhost:3000 against a live gateway. Do not edit any file in the project and never run git.
Take your own screenshots of the REAL app into ${D}\\review\\<your-lens>\\ (create the folder) with:
    cd "${SHOTS}" && node render.mjs "http://localhost:3000/<path>" "<out>.png" 1440 900 light viewport      (also: dark; 390 844 for a phone; "full" instead of "viewport" for the whole page)
Pages: / , /messages , /messages?status=UNDELIVERED , /messages/<id from ${D}\\message_id.txt> , /send . For live traffic on the Overview, run in the background from ${ROOT}:  uv run loadtest/load_test.py --gateway-url http://127.0.0.1:8000 --carrier-url http://127.0.0.1:9000 --messages 1500   and screenshot 10 to 15 seconds in.
Read every screenshot you take. Report at most 14 findings, most severe first, each specific enough to act on (which page, which element, what is wrong, the fix). No praise, no general advice.`

const critiques = await parallel([
  () => agent(`${CRITIC_COMMON}
LENS "craft": you are a design director. Compare each real page side by side with its mock-up PNG and with the brief. Where does the build fall short of the mock-up: alignment (is there one shared left edge, do numbers align on the decimal, do baselines line up), spacing rhythm, type scale and weights (off-scale sizes, wrong face for figures), rules (boxes where there should be rules, rules missing), the colour system (is every status ink right, is colour used only where it means something, is the pipeline strip the one large colourful object, is attention scarce), dark theme quality, anything from the ban list that crept back in (cards, pills, icons in front of labels, uniform padding, decorative chrome), copy that restates the obvious. Would a designer say "generated" about any part? Name the part.`, { label: 'critique:craft', phase: 'Critique', schema: FINDINGS, model: 'opus' }),
  () => agent(`${CRITIC_COMMON}
LENS "operator and robustness": you are an on-call engineer and an accessibility reviewer. Check: can each Overview question be answered in five seconds (flowing? queue growing? at the limit? money consistent? anything dead?); do failures stand out when scanning the list; is the history readable in order; is the send cost and its reason obvious. Then robustness: every state (loading, empty, error: stop reading here and use the browser-free way, by taking screenshots of /messages?q=+19999999999 for empty and of a page while the list is filtered to nothing; for error states read the code), phone width 390 (nothing overflows the viewport horizontally, nothing overlaps, tables scroll inside their wrapper), dark theme contrast (run "npm run check:contrast" in ${DASH}), long values (read the code for truncation), keyboard focus visibility (read the CSS), aria-live on live regions, status never by colour alone, text below 11px. Also run "npm run lint", "npm run typecheck" and "npm run test" in ${DASH} and report any failure as a high finding.`, { label: 'critique:operator', phase: 'Critique', schema: FINDINGS, model: 'opus' }),
])

const findings = critiques.filter(Boolean).flatMap(c => c.findings)
log(`critique: ${findings.length} findings`)

const polish = await agent(`${COMMON}
YOUR TASK: THE POLISH PASS. You own the whole dashboard now; nobody else is editing it. The foundation and the three pages were built by four engineers; their reports and two critics' findings are below.

1. Fix every finding (if one is wrong, skip it and say why). Then look for yourself: screenshot every page in light, dark and at 390px, compare with the mock-up PNGs, and fix what still falls short. Make the four pages feel like one hand made them (same spacing rhythm, same table language, same headline treatment).
2. Clean up: remove packages that are no longer imported (geist, recharts, lucide-react if unused) with npm uninstall so package.json and package-lock.json are right; delete components and CSS that nothing uses; make sure no font is fetched from a CDN.
3. All of these must pass: npm run lint, npm run typecheck, npm run test, npm run check:contrast, and npm run build. For the build, the shared dev server must be stopped first and started again afterwards. Stop it (PowerShell):  Get-NetTCPConnection -LocalPort 3000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }   then build, then start it again in the background from ${DASH} with:  GATEWAY_URL=http://127.0.0.1:8000 ADMIN_TOKEN=dev-admin-token npx next dev --port 3000   and wait until http://localhost:3000/ answers.
4. Update ${DASH}\\README.md (structure, the design language in a short paragraph, how live updates work) so it describes what is there now.
5. Take the README screenshots of the real app at 1440x900, device scale 2 (edit nothing in the render script; use a copy of it in ${D}\\final\\ with deviceScaleFactor 2), into ${ROOT}\\docs\\screenshots\\ replacing the existing files with the same names: overview.png (light, WITH live traffic: run the load command from the brief with --messages 2500 in the background and capture about 20 seconds in), overview-dark.png (dark, also with traffic), messages.png (light), detail.png (light, the message in ${D}\\message_id.txt), send.png (light, with the UCS-2 three-segment text from the mock-up typed in; a Playwright script that fills the form is fine: playwright-core is installed in ${SHOTS}, use channel "msedge"). Read each final screenshot and make sure it is one you would put in a portfolio.

FOUNDATION REPORT:
${String(foundation).slice(0, 2500)}

PAGE REPORTS:
${pages.map(p => String(p).slice(0, 2500)).join('\n---\n')}

CRITICS' VERDICTS:
${critiques.filter(Boolean).map(c => c.verdict).join('\n')}

FINDINGS:
${JSON.stringify(findings, null, 2)}`, { label: 'restyle:polish', phase: 'Polish', model: 'opus' })

return { foundation: String(foundation).slice(0, 3000), pages: pages.map(p => String(p).slice(0, 2000)), critiques, polish: String(polish).slice(0, 5000) }

```

## What the sub-agents returned

Some reports below stop in the middle of a sentence. The script itself cut them (`.slice(0, N)`) before it returned them to the main session; nothing was cut when this file was made.

### foundation

```text
The foundation is built. `npm run lint`, `npm run typecheck`, `npm run test` (195 passing) and the new `npm run check:contrast` all pass. I did not run `npm run build`, as the task said.

## What I built (all under `C:\Users\Ico\Desktop\Ico\Work\Digi Comm\dashboard`)

**1. Fonts.**
- Installed `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-mono`.
- `src/app/layout.tsx` imports Sans 400, 400-italic, 500, 600 and Mono 400, 500 once. `geist` is gone from the layout and the CSS.
- The `geist`, `lucide-react` and `recharts` packages are still in `package.json`, left for the last engineer.

**2. Tokens.** `src/app/globals.css` holds the full Ledger token set plus the colour system:
- Every status has a fill role (`--st-*`) and a text role (`--st-*-text`), plus attention, focus, flash, strip, chart and time-strip roles.
- The dark values are written once, under `:root[data-theme="dark"]`. `next-themes` now runs with `attribute="data-theme"`, `defaultTheme="system"`, `enableSystem`, and the `dark:` variant follows it.
- The roles are mapped into Tailwind with `@theme inline`, so `text-ink`, `bg-paper`, `border-rule`, `text-st-failed-text`, `fill-chart-receipts` and similar exist.
- Tailwind's default colours, type sizes, radii and shadows are switched off. The type scale is `text-label` 11, `text-small` 12, `text-body` 13, `text-lead` 15, `text-figure` 24, `text-display` 30.

**3. Contrast check.** `scripts/check-contrast.mjs`, run as `npm run check:contrast`, reads the values from `globals.css`.
- Text roles must reach 4.5:1 (5:1 for `--ink-3`) on `--paper` and `--paper-sunk`, in both themes.
- I also check fills used as marks or lines against 3:1, the WCAG minimum for graphics.
- It passes. Values that differ from the brief:
  - Light `--ink-3` is `#635F56` (5.24:1 on paper-sunk).
  - Light stone is `#8A857A` and light ochre `#A87A1C`, darkened so their marks reach 3:1.
  - Dark paper-sunk is `#201F1B`, dark ink-2 `#B8B3A6`, dark ink-3 `#9A958A`.
  - The suggested light text roles were all kept.

**4. Base styles,** in `src/styles/{base,page,masthead,table,status,forms,states,motion,responsive}.css`, imported by `globals.css` inside `@layer components` so utilities still override them. They cover:
- the hanging-margin page grid and the section rule
- the headline and lede
- the dotted-leader facts list and the property list
- the data table: baseline rows with `--row-pad` and a compact variant, sticky head, total row with the double rule, group / gap / note rows, hover and selected rows that stay inside the grid
- underline fields, the textarea, select, checkbox, switch, and the preset group
- buttons: primary solid ink, secondary ink outline, quiet underlined word
- links, the 2 px ultramarine focus ring, the 120 ms value flash and 240 ms row fade (both off under reduced motion), and the under-768 px rules.

**5. Components** in `src/components/ui`, with old exports kept so pages compile:
- `StatusMark`, `StatusWord` (alias `StatusLabel`)
- `Se
```

### pages

```json
[
  "## Overview page: what I built\n\nThe Overview page is rebuilt in the Ledger layout with the colour system and every graft I was asked for. `npm run lint`, `npm run typecheck` and `npm run test` all pass (293 tests, 36 of them new). I did not run `npm run build`. I edited no foundation files and no other page's folder, and ran no git commands.\n\nAll files are in `C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\components\\overview\\`. `src/app/(console)/page.tsx` did not need changing.\n\nI deleted `stat-tiles.tsx`, `tenant-cards.tsx`, `status-bar.tsx` and `pipeline-strip.tsx`. The Overview no longer imports recharts or lucide-react.\n\n**Headline and lede**\n- `headline.ts` is a pure function, `overviewHeadline`, with the full state table in priority order: loading, unreachable, ledger mismatch, stalled, backing up, flowing, draining, idle. Each state has a test in `headline.test.ts`, and one more test checks that the words stay the same when only a figure changes.\n- The function returns the sentence as parts (verdict, text, figure, attention).\n- In the ledger-mismatch state, the traffic sentence moves into the lede so it is still visible.\n- Backing up starts when the oldest queued message is older than 30 s (`BACKING_UP_AFTER_MS`).\n- Unreachable means the overview request failed and the stream is not live. It names the time data was last seen, in UTC.\n- Only the verdict is announced to screen readers, and only when it changes.\n- `overview-headline.tsx` renders the sentence and the lede. The lede holds the drain time (\"drains in about …\"), dead webhooks and the ledger state.\n\n**Key figures (`key-figures.tsx`)**\n- The dotted-leader list from the mock-up.\n- Queue depth has a 60-sample sparkline and its change over the window, for example \"−127 in 3 s · queue, live\". The note says \"polled every 15 s\" when the stream is down.\n- The samples come from a client-side ring buffer fed by `stats` events (`queue-trend.ts`, `use-queue-trend.ts`, tested).\n- Only values that cross a ",
  "## Messages list and Message detail: report\n\nThe Messages list and the Message detail are rebuilt in the Ledger language, with the colour system and the grafts from the brief. `npm run lint`, `npm run typecheck` and `npm run test` all pass (296 tests; 49 of them are new). I did not run `npm run build` or any git command. I only touched `src/components/messages`, `src/components/message-detail` and the two page files under `src/app/(console)/messages`.\n\n### What I built\n\n**Messages list** (`C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\components\\messages\\`)\n- **Margin column:**\n  - the live total \"messages on record, 2 tenants\", which flashes when it changes\n  - \"Newest first. Times are UTC, when the API accepted the message.\"\n  - the status key (`status-key.tsx`)\n  - There is no label that repeats the nav tab, and the page has a visually hidden `<h1>`.\n- **Filter row** (`filter-bar.tsx`, `search-box.tsx`, `utc-bound-input.tsx`):\n  - Search with a `/` hint; `/` focuses the field when you are not typing somewhere else.\n  - Tenant and Status selects.\n  - \"Created (UTC)\" with the presets All / 15 min / 1 h / 24 h / 7 d next to the From and To fields.\n  - From and To are now UTC text fields (\"2026-11-24 15:57\"). They commit on Enter or when you leave the field; text that is not a time shows \"Write it as YYYY-MM-DD HH:MM\" under the field.\n  - \"Clear all\" keeps its place when it is hidden, so the fields do not shift.\n  - The URL format, `range=custom` and the debounce work as before.\n- **Live line** (`live-control.tsx`):\n  - \"Following new messages\" with Pause / Resume.\n  - When the stream is down, \"Stream down: reading the list again every 15 s\" in the ochre text colour.\n  - \"Show N new messages\" and a quiet Refresh button.\n  - The line has a fixed height, so the new-messages notice never pushes the rows. It is still announced once to screen readers.\n- **Table** (`messages-table.tsx`, `message-row.tsx`, `messages-table.module.css`):\n  - Columns: Time UTC (millise",
  "The Send test page is rebuilt from `a/send.html` with the colour system and the grafts. `npm run lint` and `npm run test` pass (289 tests). `npm run typecheck` has 2 errors, both in another engineer's Messages work: `listKey` is missing in `src/components/messages/messages-fallback.tsx:23` and `src/components/messages/messages-view.tsx:101`. I did not touch them. I did not run `npm run build`.\n\n**What I built** (all in `C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm\\dashboard\\src\\components\\send`; `page.tsx` is unchanged)\n- **Headline:** `send-copy.ts` has `sendHeadline`, a pure function with its state table in the doc comment, tested in `send-copy.test.ts`. States in priority order:\n  - nothing typed: \"0 segments. Type the text to see what it costs.\"\n  - too long (over 10 segments)\n  - no destination\n  - invalid destination: \"…but the destination is not an E.164 number.\"\n  - prices loading, prices failed\n  - no price: \"No price for +4915112345678, so it can not be sent.\"\n  - over balance\n  - priced: \"3 segments in UCS-2, 0.0120 USD.\"\n- **Other pure copy in the same file, also tested:** the button label (\"Send 3 segments · $0.0120\"), the From hint (\"Alphanumeric sender, 8 of 11 characters\") and the To hint (\"Bangladesh, prefix +880, 0.0040 USD per segment\").\n- **UCS-2 explanation:** `ucs2-cause.ts` (`explainUcs2`, tested) finds each character that forces UCS-2, with its code point, character position, segment and use count, plus what the text would be without it. `ucs2-note.tsx` sets this as the vermilion-ruled note, for example: \"📦 U+1F4E6 at character 118 in segment 2 … Without it this text is GSM-7 and fits in 1 segment, 0.0040 USD instead of 0.0120 USD.\" With more than 3 different characters it names only the first.\n- **Form** (`send-view.tsx`): fields in the mock-up order (Tenant, From, To, Text, Client reference) with inline validation text.\n  - The text hint reads \"148 UTF-16 units\" on the left and \"UCS-2 because of 1 character\" in vermilion on the right.\n  - The c"
]
```

### critiques

```json
[
  {
    "verdict": "It reads as a designed product: the margin column, the rules, Plex Sans with Plex Mono figures and the pipeline strip are close to the Ledger mock-up, and the colour system is in place in both themes. What holds it back is a run of small jobs left half done, and those are what a designer would call generated: the Queue depth sparkline that draws as a broken stub, the Recent failures IDs that grey out the part that tells rows apart, zeros that never dim, Messages columns that move when the filter changes, and loose ends in spacing and wrapping (the Detail headline, the Send rate card).",
    "findings": [
      {
        "page": "/ (Overview), hero ledger, Queue depth row",
        "severity": "high",
        "what": "The queue sparkline (graft 12) is not a sparkline. With a few samples it draws as one slanted black stroke about 6 px wide, right against '1,596'. In the idle state it is a lone dot, '• 0'. The dotted leader stops at about x=1315, leaving an empty hole of about 30 px before the glyph. The change line under it reads '−86 in 2 s · queue, live' on its own second line, so this row is twice as tall as the seven rows below it and the ledger's rhythm breaks.",
        "fix": "Give the sparkline a fixed box (about 64×14 px) that the leader stops at, and draw a hairline baseline across the whole box from the first sample. Hide the polyline until there are at least 10 samples, and plot samples from the left so it never collapses into a stub. Put the change on the same line as the label ('Queue depth  −86 in 60 s') instead of a second line, keeping the row height equal to the other rows. Before 60 s of data, say 'in 12 s', not '2 s'."
      },
      {
        "page": "/ (Overview), Recent failures, MESSAGE column",
        "severity": "high",
        "what": "The ID detailing is the wrong way round. All six rows show '01a20e9a-03e4' in --ink, and the part that actually differs ('-74f8-8294-589fceefa123', '-711d-…') is in --ink-3. The eye reads six identical IDs, and the meaningful characters are the faint ones.",
        "fix": "Compute the distinguishing span per list: the shortest suffix (or middle segment) that is unique among the visible rows. Set that span in --ink and the shared prefix in --ink-3. The same rule applies to the Messages MESSAGE column."
      },
      {
        "page": "/messages (all states), MESSAGE column",
        "severity": "high",
        "what": "IDs show as '01a20e9a-a772-706a': the first two groups plus the last four characters, with the middle removed and no elision mark. That string is not the ID. It looks complete, so it will be copied, read aloud and pasted into search as if it were. The brief asks for real IDs, 'never ellipsis-truncated'. The mock-up's honest form was '01a20e47-242d…'.",
        "fix": "Either show the full 36-character ID in 13 px mono (the table has room if TEXT gives up about 60 px), or keep the short form with a visible elision glyph ('01a20e9a-a772…706a') and the full ID in title and in the link href. Never show a silent splice."
      },
      {
        "page": "/ (Overview) idle and live: hero ledger, pipeline label row; /messages ATT and SEG columns",
        "severity": "medium",
        "what": "Zeros are never dimmed (graft 8). In the idle Overview, 'In flight at carrier 0', 'Webhooks pending 0', 'Webhooks dead 0' and 'Double charges 0' are full ink. In the pipeline label row, 'Accepted 0', 'Queued 0' and 'Submitted 0' are full ink, and the status words 'Queued' (ochre) and 'Submitted' (ultramarine) stay coloured even when their count is 0. Colour is being spent on empty categories.",
        "fix": "Add one formatter (for example a <Num> component) that applies --ink-3 when value === 0 and use it in the ledger, the pipeline labels, the tenant table and the Messages numeric columns. When a pipeline category's count is 0, also set its status word and mark to --ink-3, so the colour appears only when something is there."
      },
      {
        "page": "/messages vs /messages?status=UNDELIVERED",
        "severity": "medium",
        "what": "Column positions move with the data. MESSAGE starts at x=367 unfiltered and x=364 filtered, TENANT at 523 vs 516, TEXT at 789 vs 807, STATUS at 993 vs 1005, COST at 1222 vs 1226. The table is auto-layout, so switching a filter (or a new row arriving) shifts every column and the header. On a live-following list this reads as jitter.",
        "fix": "Use table-layout: fixed with a <colgroup> of set widths (time 110, message 150, tenant 100, to 125, from 75, status 125 incl. min-width 11ch, enc 60, seg 50, cost 70, att 40, final 70) and let TEXT take the remainder."
      },
      {
        "page": "/messages/<id> (Detail), headline",
        "severity": "medium",
        "what": "The display sentence breaks after 'in', so line 1 ends 'Delivered to +971506701448 in' and line 2 starts '9.17 s, on the second submit attempt.' The figure is cut from its preposition. The mock-up breaks after '9.17 s,' because its measure is wider (about 775 px); the build's is about 690 px.",
        "fix": "Widen the headline measure to match the mock-up (max-width about 52ch at 30 px), add text-wrap: balance, and wrap '{duration} s' together with the word before it in a nowrap span so 'in 9.17 s' never splits."
      },
      {
        "page": "/messages/<id> (Detail) outcome line and margin; / (Overview) throughput side figures",
        "severity": "medium",
        "what": "Mono figures followed by a sans unit leave a double gap: 'the retry 303  ms later', 'Accept to webhook, 9.222  s', '0.781  s in the gateway', '8.394  s with the carrier'. A normal space after the mono span is followed by a mono-width space or padding, so the figure floats away from its unit.",
        "fix": "Render value and unit through one helper: the unit inside the same mono span after a thin space (U+2009), or the unit in sans with a single U+2009 and no margin on the number span. Remove any trailing space or padding-right on the figure class."
      },
      {
        "page": "/ (Overview), Carrier throughput chart",
        "severity": "medium",
        "what": "The three direct labels ('Carrier limit 50', 'Target 46', 'Submitted 46 now') are stacked as a block in the top-right corner. 'Submitted 46 now' sits at y≈823 while its line ends at y≈806, so it is labelling empty space. Target 46 has no tick on the y axis, and the axis shows only '50' and '0'. The receipts strip puts its own '63' about 30 px under the submits '0', so the left edge reads '0 / 63 / 0'.",
        "fix": "Anchor each label to the y of its line end and nudge only by the minimum needed to clear the label above (about 12 px), with a 1 px leader if moved. Add a '46' tick for the target. Separate the receipts strip by a 16 px gap and label its axis with the unit ('63/s' at top, no second '0', since the bars from zero already say it)."
      },
      {
        "page": "/send, Rate card (empty and filled states)",
        "severity": "medium",
        "what": "The rate card's header rule and row hairlines run the full 640 px to x=1400, but the columns stop at x=1190 (PER SEGMENT is right-aligned there). Every row has about 210 px of bare rule on the right. In the filled state, 'matches +8801711000001' floats in that gap on the emphasised row. The rule length does not match the content.",
        "fix": "Either cap the rate-card table at the width of its three columns (about 430 px) so the rules end with the figures, or make the matched note a fourth column with a header ('MATCH') so the rules have content to the edge. The totals table above should follow the same rule."
      },
      {
        "page": "/send, empty state headline",
        "severity": "medium",
        "what": "The display sentence reads '0 segments. Type the text to see what it costs.' It leads with a meaningless zero at 30 px, which is the generic 'restate the obvious' copy the brief bans. The Send button says just 'Send', in full solid ink, although nothing can be sent.",
        "fix": "Make the nothing-typed state of the send headline function say what is missing: 'Nothing to price yet. Pick a destination and type the text.' (no figure). Show the primary button disabled (ink outline at --ink-3) until there is a priced, valid message, then switch it to 'Send 3 segments · $0.0120'."
      },
      {
        "page": "/send, TEXT field",
        "severity": "low",
        "what": "In the mock-up, the character that forces UCS-2 (📦) is marked inside the message text with a vermilion outline. In the build, the textarea shows the emoji unmarked. The vermilion marking appears only in the preview's split segments and in the line below the field ('UCS-2 because of 1 character'), so the attention mark is not on the thing it is about.",
        "fix": "Put a mirrored highlight layer behind the textarea (same font, padding and wrapping, transparent text) that draws a 1 px vermilion box around each non-GSM-7 character, as in a/send.png."
      },
      {
        "page": "All pages, first line of the margin column vs the content",
        "severity": "low",
        "what": "Top baselines do not share a line. On Overview the margin date sits at y≈95 against the headline cap at y≈85 and its first baseline at about 110. On Detail, 'Back to messages' (≈88) sits against the ID line (≈94). On Messages the 26 px '28,215' sits against the 11 px 'SEARCH' label. In the mock-up, the margin's small-caps label and the content's first label sit on one baseline at y=88.",
        "fix": "Set padding-top on the margin and content columns so the first text baseline of each lands on the same 4 px grid line (88). On Overview, move the snapshot time down to the headline's first baseline. On Messages, put a small-caps label line above the big count so the count is not the first line."
      },
      {
        "page": "/ (Overview) dark, hero ledger",
        "severity": "low",
        "what": "In the dark screenshot, '1,552', '36.1 s' and '9' sit on filled --paper-sunk rectangles. The value-change flash is drawn as a background box, which reads as a highlighted cell (a box, and a chip) rather than the ink flash the brief asks for. At 1440 px several of them are caught on screen at once during traffic.",
        "fix": "Animate the text colour only (ink → ultramarine text role → ink, 120 ms), not background-color. Keep the prefers-reduced-motion guard."
      },
      {
        "page": "/ (Overview) at 390 px",
        "severity": "low",
        "what": "At phone width, the tenant OUTCOMES bar runs to the right edge with its delivered percentage clipped. Recent failures shows only time, status and tenant: the MESSAGE link (the only way into Detail) is cut off with no sign that the table scrolls. The throughput chart gives about half its width to the direct labels, leaving a plot about 140 px wide.",
        "fix": "Shrink the tenant bar to calc(100% − 6ch) with the % beside it. Wrap Recent failures in the same horizontal-scroll wrapper as Messages, or make the time cell the link under 768 px. Under 768 px, move the chart's direct labels above the plot so the plot gets the full width."
      }
    ]
  },
  {
    "verdict": "Yes, it reads as a designed product. Lint, typecheck, 296 tests and the contrast script all pass, nothing overflows at 390 px, focus rings show, and status always has a mark as well as a colour. What holds it back for an on-call operator is that the Overview verdict trails reality by up to a minute, and on a phone the failure details sit off-screen in the tables: the reason, the link and what happened.",
    "findings": [
      {
        "page": "/ (Overview headline)",
        "severity": "high",
        "what": "The headline verdict and rate trail reality by up to 60 s. headline.ts calls the queue 'stalled' only when summary.submitted.total === 0 over the whole 60 s window, and every verdict quotes the 60 s mean. Seen at 17:28:38 (ov-live-light.png): 'Traffic is flowing at 10.6 submits/s' while the chart and the figure beside it say 46 in the last second. The reverse case is worse: if the carrier stops taking submits, the page keeps saying 'Traffic is flowing at ~40 submits/s', with the number slowly falling, until the oldest message passes 30 s or the whole window empties. So 'is it flowing?' gets a wrong answer exactly when it matters.",
        "fix": "In trafficSentence, decide 'stalled' from the last 5 to 10 samples (depth > 0 and zero submits in them), not from the 60 s total. When the last 10 s mean differs from the 60 s mean by more than 2x, quote the recent rate in the sentence ('46/s now, 10.6/s over the last minute'). Decide 'at the limit' from the last 10 s as well. Add state-table tests for ramp-up and sudden-stop sample series."
      },
      {
        "page": "/ (Recent failures), phone 390",
        "severity": "medium",
        "what": "Each failure links only through the message ID in the last column; the time, status and tenant cells are plain text, and unlike the Messages table the row has no click handler. At 390 px (ov-live-phone.png) the table shows only Outcome at / Status / Tenant; Reason and the ID link are scrolled out of view. So on a phone the list neither says why a message failed nor opens it.",
        "fix": "Make the pinned time cell a Link to /messages/<id>, or reuse the Messages row click handler. Under 768 px, show the reason as a second line under the status word and give the Reason and To columns the hide-narrow class."
      },
      {
        "page": "/messages/<id> (History), phone 390",
        "severity": "medium",
        "what": "At 390 px (detail-phone.png) the pinned Time UTC column plus Since accept and Source fill the whole width. 'What happened' (which holds the vermilion 'Unavailable, HTTP 503' attempt and the status words) and Detail are cut off at the right edge. The gap rows ('0.303 s backoff…') are clipped mid-word. On a phone you cannot read the history in order without scrolling every row sideways.",
        "fix": "Under 768 px, give Since accept the hide-narrow class and put Source above What happened in one cell, or pin What happened next to Time. Let the gap rows span the visible width (sticky left, width 100vw minus the gutters)."
      },
      {
        "page": "/messages/<id>, / (all tables)",
        "severity": "medium",
        "what": "Long values have no breaking rule. table.css sets td white-space: nowrap, and `.t td.wrap` changes only white-space, with no overflow-wrap. overflow-x: auto on .table-wrap.scroll-x exists only under 768 px. The history Detail cell holds tenant webhook URLs and carrier error strings, so a 150-character URL with no spaces widens the history table past its column and into the Message facts aside at 1440. Tenant names: .tenantName has no overflow-wrap (a single long word overflows its 220 px), and under 768 px it is white-space: nowrap in a pinned sticky column, so a long name can cover the whole scroll viewport.",
        "fix": "Add `overflow-wrap: anywhere` to `.t td.wrap` and to .tenantName. Apply overflow-x: auto to .table-wrap.scroll-x at every width. Under 768 px, clip the pinned tenant name to about 140 px with a title attribute instead of nowrap at full length."
      },
      {
        "page": "/messages (error state)",
        "severity": "medium",
        "what": "A shared or hand-edited link with an unknown tenant (?tenant=acme-bank, a slug rather than the ID) shows 'Messages could not be loaded. Request validation failed. Retry' (msg-filtered-none.png). Retry can never succeed, and the Tenant select shows the raw value 'acme-bank' as if it were a valid choice. The raw API wording reaches the operator.",
        "fix": "Check the tenant parameter against the tenants list. If it is unknown, show 'No tenant has the ID acme-bank' with Clear filters rather than Retry, and show the select empty. Map a 4xx validation error on the list endpoint to a filter-problem line, not the network error line."
      },
      {
        "page": "/messages (URL filters)",
        "severity": "medium",
        "what": "If from/to are in the URL without range=custom, the From and To inputs show the dates (2020-01-01 00:00 – 2020-01-02 00:00) while the 'All' preset stays selected and createdBounds ignores them. The list showed 24 Nov 2026 rows under a visible 2020 range (msg-filtered-none2.png), so the filter on screen is not the filter applied.",
        "fix": "In useMessageFilters, treat range as 'custom' whenever from or to is present and range is absent, or clear from/to when range !== 'custom'. Add a unit test for that URL."
      },
      {
        "page": "/messages (live line)",
        "severity": "low",
        "what": "'Following new messages' with the Pause button appears next to 'Show 1 new message' (msg-undeliv-dark.png). New rows are counted, never inserted, so the list is not following new messages; only the statuses of loaded rows update live. The two controls contradict each other.",
        "fix": "Change the live state copy to 'Statuses update live; new messages wait above' or 'Live', and keep the 'Show N new messages' button as the only cue that rows are waiting."
      },
      {
        "page": "/messages (Message column)",
        "severity": "low",
        "what": "The ID link shows three groups ('01a20e9a-a772-706a') and puts the rest in sr-only, with no visible sign that anything is missing. It reads as a complete, if short, ID. An operator reading it aloud or typing it into search gets no match.",
        "fix": "After the shown groups, add a visible '…' in --ink-3 (aria-hidden, since the sr-only remainder already covers screen readers), or show the last 4 characters behind the ellipsis."
      },
      {
        "page": "/ (Key figures, queue trend)",
        "severity": "low",
        "what": "The queue trend starts empty on each page load: '−83 in 2 s · queue, live', and the sparkline is a 2 px stub drawn as a slash beside the number. For the first minute after opening the page, 'is the queue growing?' rests on 2 to 10 seconds of samples.",
        "fix": "Show the change only after at least 10 s of samples, with 'trend from 10 s' until then. Or seed the ring buffer from overview.throughput (accepted minus submitted per second) so a full 60 s window exists at load."
      },
      {
        "page": "/send",
        "severity": "low",
        "what": "With an invalid destination (+88017, send-invalid-dark.png), the primary button still reads 'Send 1 segment' and is enabled; the price silently drops out of the label. The button uses '$0.0120' while the preview, rate card and balance all use '0.0120 USD'.",
        "fix": "Set aria-disabled when the destination is invalid or has no price, and label the button 'Send 1 segment · no price for this number'. Use one currency notation everywhere ('Send 3 segments · 0.0120 USD')."
      },
      {
        "page": "/messages/<id>",
        "severity": "low",
        "what": "There is a double gap between figure and unit: '9.222  s' (margin 'Accept to webhook'), '303  ms' (outcome line), '0.781  s', '8.394  s' and '0.048  s' (time strip legend). The mono figure plus a leading space in the unit text renders wider than the single spaces elsewhere.",
        "fix": "In phrase-text.tsx and the time-strip legend, render figure and unit with one non-breaking space and no trailing space inside the figure span."
      },
      {
        "page": "/messages, phone 390",
        "severity": "low",
        "what": "At 390x844 (msg-phone.png) the count, the note, Search, Tenant/Status, the range presets, From/To and the live line take everything above y≈580; only 7 rows are visible, and the status filter needs a scroll back up.",
        "fix": "Under 768 px, keep Search and a 'Filters (n)' disclosure that holds Tenant, Status and Created. Move the 'Newest first…' note below the table."
      },
      {
        "page": "/messages/<id> (not found)",
        "severity": "low",
        "what": "The not-found sentence sets the ID inside the 30 px display line with break-all, so it breaks mid-token ('not-a / n-id', '7000- / a000-0000…') in sans at display size, not mono (detail-404.png, detail-bad.png).",
        "fix": "Put the ID on its own line under 'No message has this ID.' in mono at body size, with overflow-wrap: anywhere instead of break-all."
      },
      {
        "page": "/ (phone 390: Throughput, Tenants)",
        "severity": "low",
        "what": "In the throughput margin, 'range 0–63' wraps between '0–' and '63'. In Tenants, the 200 px minimum outcome bar pushes the delivered % and the per-tenant Ledger cell off-screen, with no sign that the table scrolls (ov-live-phone.png).",
        "fix": "Give range figures white-space: nowrap. Under 768 px, cut the outcome bar to about 120 px so the % stays in view, or put the % before the bar, and fade the right edge of the scroll wrapper to show that more columns follow."
      }
    ]
  }
]
```

### polish

```text
## Polish pass: what I did

The polish pass is finished. All five checks passed after my last code change:
- `npm run lint` and `npm run typecheck`
- `npm run test`: 288 tests in 21 files. The count dropped from 296 because I deleted the tests of formatters I removed, and added tests for the new code.
- `npm run check:contrast`
- `npm run build`. I stopped the shared dev server first. Afterwards I started it again on port 3000 with the given GATEWAY_URL and ADMIN_TOKEN, as a detached process (log in `%TEMP%\dashboard-dev.log`), so it keeps running after this session ends. It answers 200.

After the build I only edited the two READMEs.

I ran no git command and touched nothing outside `dashboard/`, apart from replacing the five files in `docs/screenshots/`.

### Findings fixed (all paths under `dashboard/src`)

**Queue sparkline** (`overview/sparkline.tsx`, `queue-trend.ts`, `ui/facts-list.tsx`)
- Fixed 64×14 box with a hairline zero baseline. Samples are plotted from the left.
- The line, and the change, appear only after 10 samples.
- The change sits on the label line ("Queue depth −709 in 17 s · live"), so every row in the list has the same height.

**Message IDs** (`ui/message-id.tsx`)
- New `sharedIdPrefix()` in `lib/format.ts`. The groups every visible ID shares go to `--ink-3`; the part that tells rows apart stays in ink. This applies on Overview Recent failures and in the Messages list.
- The short form in Messages ends with a visible "…". It is drawn by CSS, so it is not copied with the ID and screen readers do not read it. The full ID is in the title, and the rest stays in sr-only text.

**Zeros and empty statuses**
- Zeros are dimmed in the key figures.
- New `StatusWord muted` prop: a status with a count of 0 shows its mark and word in `--ink-3` in the pipeline label row.

**Messages table**
- `table-layout: fixed` with a `<colgroup>` and set widths; Text takes what is left. Columns no longer move when the filter changes.
- `min-width: 1040px`, so it still scrolls sideways on a phone.

**Detail page**
- Headline measure is 26em (`.headline-wide`).
- `PhraseText` keeps the word before a figure on the same line ("in 9.17 s").
- Not found: "No message has this ID." with the ID on its own line in mono.

**Number and unit gaps**
- New `FigureText`: numbers in mono, units in sans, kept on one line. `Money` with a currency was rebuilt the same way.
- Used on Detail, Overview and the Send UCS-2 note.

**Throughput chart**
- Each line label sits at its line's end and moves only as far as it must, with a 1 px leader when moved.
- The y axis now has a "46" tick for the target.
- The receipts strip's axis reads "63/s", with no second 0.
- Under 520 px the labels become a keyed row above the plot, so the plot gets the full width.

**Send page**
- Rate card: the Match column has a visible header.
- Nothing typed: "Nothing to price yet. Enter a destination and type the text."
- The button is an ink-3 outline until the draft is priced and valid. Its label always says what is missing ("· no price for this number", "· not a valid number").
- One currency notation everywhere ("0.0120 USD"), including the toast.
- `marked-textarea.tsx` draws a vermilion box around each character that forces UCS-2, inside the text field itself.

**Overview headline lag** (`overview/headline.ts`, with tests)
- "Stalled" and "at the limit" are now judged on the last 10 s.
- When the recent rate differs from the 60 s mean by more than 2×, both are quoted ("46.0 submits/s now, 9.2/s over the last minute").
- Ramp-up, sudden-stop, slow-down and at-the-limit cases are tested.

**Phone layouts (390 px)**
- Recent failures: the time cell is a link to the message, the reason shows as a second line under the status, and To and Reason are hidden.
- History: Since accept and Source are hidden, the source heads the What happened cell, and gap rows sit in the pinned first column.
- Tenants: the outcome bar is 96 px with the % in front of it.
- Messages: the filters other than search fold behind a "Filters (n)" button, and the reading note moves under the table.
- Sideways-scrolling tables fade at the right edge while more columns follow.

**Other fixes**
- Long values: table cells that wrap and tenant names now break anywhere.
- Unknown tenant in the URL: "No tenant has the ID acme-bank." with Clear filters, and the select reads "No such tenant".
- A 4xx from the list endpoint shows as a filter problem, not a network error with Retry.
- `normalizeFilters()` (tested): bounds without a range mean the custom range; bounds beside a preset or All are dropped, so the fields always show the filter in force.
- The live line now reads "Statuses update live; new messages wait above the list".
- First baselines of the margin and content columns line up on Overview and Detail. Messages has an "On record" label above its count.
- The change flash now animates the ink only, no background box.
- The throughput range figures no longer wrap.

### Two findings hand
```
