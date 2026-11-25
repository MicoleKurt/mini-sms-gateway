# Workflow 4: dashboard-art-direction

A workflow is a script that the main session wrote to run several sub-agents. The script below holds every prompt the sub-agents received. [Back to the index](../README.md).

| | |
|---|---|
| Started | 2026-11-25 00:27 (UTC+8) |
| Duration | 17.5 minutes |
| Sub-agents | 6 |
| Tool calls by sub-agents | 229 |
| Status | completed |
| Default model | claude-fable-5-2 |
| Run id | wf_d71f2e48-3b5 |

## Phases

- **Mock** (model: opus): three art directions as real HTML, rendered and self-critiqued
- **Judge** (model: opus): three judges score the screenshots from different points of view

## Summary

Three designers each build a rendered mock-up of the dashboard in a different art direction; three judges score the screenshots and a winner is chosen

## Log lines

```text
mock-ups finished: Ledger, Console, Signal
winner: a (wins {"a":2,"b":1,"c":0}, totals {"a":22,"b":20,"c":20})
```

## Script

```js
export const meta = {
  name: 'dashboard-art-direction',
  description: 'Three designers each build a rendered mock-up of the dashboard in a different art direction; three judges score the screenshots and a winner is chosen',
  phases: [
    { title: 'Mock', detail: 'three art directions as real HTML, rendered and self-critiqued', model: 'opus' },
    { title: 'Judge', detail: 'three judges score the screenshots from different points of view', model: 'opus' },
  ],
}

const S = 'C:\\Users\\Ico\\AppData\\Local\\Temp\\claude\\0aaf5675402adb95\\e1bcbcbb-6672-4634-a789-27e2e0879529\\scratchpad'
const D = `${S}\\design`

const BRIEF = `
You are a senior product designer who also writes production CSS. The product is an internal operations console for an SMS gateway (a CPaaS: tenants send SMS through an API, messages are queued, submitted to a carrier that allows 50 submits per second, and finished by asynchronous delivery receipts; tenants have prepaid balances). Operators use it during incidents to answer: is traffic flowing, is anything stuck, is the money right, what happened to this one message.

The current implementation works well but looks like a template: the owner called it "AI slop" and wants it to look like a product a careful human team designed. Look at the current screens first (Read these images):
  ${D}\\current\\overview-dark.png
  ${D}\\current\\overview-light.png
  ${D}\\current\\messages-dark.png
  ${D}\\current\\detail-dark.png
  ${D}\\current\\send-dark.png
Then read the research on what makes a UI read as generated and what to do instead: ${D}\\research.md  (treat its "tells" as a ban list).
Real data to use in your mock (do not invent other numbers or names): ${D}\\data.json  (tenants with balances and counts per status, overview with queue / throughput per second / webhooks / billing, price table, 14 recent messages, and one full message detail with events, attempts, DLR, ledger and webhook).

Statuses and their meaning, in pipeline order: ACCEPTED -> QUEUED -> SUBMITTED -> DELIVERED | UNDELIVERED | EXPIRED, and FAILED branching from QUEUED. DELIVERED is the good outcome; UNDELIVERED and EXPIRED are carrier-side failures (charged); FAILED is our-side failure (refunded); QUEUED and SUBMITTED are in progress.

Hard requirements for any direction:
  - Pages: Overview (per-tenant balance and status counts, the pipeline across tenants, submits per second against the carrier limit of 50, queue depth / oldest age / in flight, webhook backlog, a ledger-consistency indicator), Messages (filter bar: search, tenant, status, date range; dense table: time, tenant, to, from, status, encoding, segments, cost, attempts), Message detail (facts + full chronological history merging status events, submit attempts, delivery receipts, ledger entries, webhook), Send test (form + live preview: encoding, units used / capacity, segments, price per segment, total, balance after, the characters that forced UCS-2, the text split into its segments).
  - Light AND dark theme from one set of CSS custom properties. Pick which one is the default and say why.
  - WCAG AA contrast for text. Status is never carried by colour alone.
  - Numbers that are compared in columns use tabular figures and align on the decimal point.
  - It must be buildable with plain CSS variables + Tailwind utilities in an existing Next.js app. Fonts must be available as npm packages that bundle the font files (the @fontsource/* or @fontsource-variable/* families, or "geist"): name the exact package for each face. No font may be fetched from a CDN in the real app (in the mock you may link Google Fonts or the fontsource CDN so the render shows the real faces).
  - No gradients, no glow, no glass, no drop shadows as decoration, no pulsing dots, no emoji. One icon style at most, and only where an icon carries meaning a word would not.
`

const DIRECTIONS = [
  {
    key: 'a',
    name: 'Ledger',
    brief: `YOUR DIRECTION: "Ledger". Light by default. The reference is a well-set financial statement or a printed timetable: an off-white paper ground, near-black ink, hairline rules instead of boxes, and almost no containers. Type does the work: a humanist or engineered sans with real character for text and a proper mono for every figure, ID and phone number (IBM Plex Sans + IBM Plex Mono is the obvious fit for a telecom product; you may choose another pairing from fontsource if you can argue it is better). One accent colour, used only for what needs attention. Status is a short word with a small geometric mark, not a pill. The Overview reads top to bottom like a statement: a single headline line that answers "are we OK", then the pipeline as one proportional strip, then tenants as rows of a table (not cards), then the throughput as a restrained strip chart with the carrier limit as a ruled ceiling.`,
  },
  {
    key: 'b',
    name: 'Console',
    brief: `YOUR DIRECTION: "Console". Dark by default, but not the zinc-and-cards dark of the current screens. The reference is a dense professional terminal tool that operators leave open all day (think of a trading terminal, htop, k9s, a well-made log viewer): a considered near-black with a slight hue, one phosphor-like accent, mono-forward typography with a sans only for prose, information packed into aligned columns with rules and column headers rather than boxes, keyboard-first hints. Everything sits on a strict character-like grid. Numbers are large where they matter and otherwise small and aligned. Status is a fixed-width code with a mark (for example a filled, half-filled or hollow square) so columns stay aligned. The Overview is one screen with no scrolling at 1440x900. Avoid the cockpit / hacker-movie cliche: no scanlines, no green-on-black, no fake terminal prompts; it must look like a serious tool, not a costume.`,
  },
  {
    key: 'c',
    name: 'Signal',
    brief: `YOUR DIRECTION: "Signal". Light by default. The reference is Swiss / International Style information design and a good transit or telecom operator's control-room wall board: a cool neutral ground, strong black grotesk type with a clear scale (a few very large tabular numerals, small precise labels), a visible grid with deliberate asymmetry (for example 8 + 4 columns), blocks of flat colour used as information (the status scale as solid colour fields with direct labels, a proportional bar per tenant), thick and thin rules, generous but unequal spacing. Bold and confident rather than quiet. One saturated signal colour for attention plus the functional status scale. Charts are drawn like diagrams: direct labels, no legend, no grid clutter, the carrier limit as a hard line with the headroom visibly shaded. Choose a grotesk with character from fontsource (for example Archivo, Schibsted Grotesk, Instrument Sans, Hanken Grotesk, or another you can justify) and a mono for IDs and figures.`,
  },
]

const MOCK_TASK = (d) => `${BRIEF}
${d.brief}

DELIVERABLES, all inside ${D}\\${d.key}\\ (create files only there; do not touch the project repository at C:\\Users\\Ico\\Desktop\\Ico\\Work\\Digi Comm, do not run git):
  1. tokens.css : the design tokens as CSS custom properties for light and dark (colour roles named for meaning, the status scale, type scale, spacing scale, radii, rule weights), with a comment per group saying how it is used.
  2. overview.html, messages.html, detail.html, send.html : four static, self-contained pages (each links tokens.css and one shared app.css; inline SVG for charts; no JS frameworks; a tiny inline script only if needed to set data-theme from ?theme=dark). They must be complete, pixel-considered screens at 1440 x 900 with the real data from data.json, including the app chrome (navigation, connection state, theme switch). The message list must show at least 14 rows; the detail page the full history of the message in data.json; the send page a filled-in form with the text "Hi! Your ShopFast order #48213 is out for delivery today between 2 and 4 pm. Track it here: shopfast.example/t/48213 📦 Thanks for shopping with us!" (148 UTF-16 units, UCS-2, 3 segments of 67/67/14, to +8801711000001, price 0.0040 per segment, total 0.0120) so the preview shows the UCS-2 warning and the three segments.
  3. Render every page in your default theme, and overview.html also in the other theme, with:
        cd "${S}\\shots" && node render.mjs "${D}\\${d.key}\\overview.html" "${D}\\${d.key}\\overview.png" 1440 900 light viewport
     (arguments: file, output png, width, height, light|dark, viewport|full; for the dark render pass dark and make your page honour prefers-color-scheme or the ?theme= parameter. Name the files overview.png, overview-alt.png, messages.png, detail.png, send.png.)
  4. LOOK at your renders (Read the PNG files). Critique them honestly against the ban list in research.md and against the current screens: would a designer immediately say "generated"? Is there one clear primary element per screen? Do columns align? Is anything boxed that does not need a box? Is any text below AA contrast? Fix and re-render. Do at least two full critique-and-fix rounds; stop when you would put your name on it.
  5. notes.md : the direction in five lines; the font packages (exact npm names) and why; the token decisions; how each status is drawn; the three things that most distinguish it from the template look; what would be hardest to implement in the real app.

Quality bar: this is judged from the screenshots against two other directions by three critical judges. Craft matters more than novelty: alignment, rhythm, hierarchy, real typography, restraint.

Final answer: a short report (what you made, what you changed between rounds, the file list).`

const SCORES = {
  type: 'object',
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['a', 'b', 'c'] },
          score: { type: 'integer', description: '1 to 10 for your lens' },
          strengths: { type: 'string' },
          weaknesses: { type: 'string' },
        },
        required: ['direction', 'score', 'strengths', 'weaknesses'],
      },
    },
    winner: { type: 'string', enum: ['a', 'b', 'c'] },
    graft: { type: 'string', description: 'specific ideas from the losing directions worth carrying into the winner' },
    must_fix: { type: 'string', description: 'specific flaws in the winner that must be fixed in the real implementation' },
  },
  required: ['scores', 'winner', 'graft', 'must_fix'],
}

const JUDGES = [
  {
    key: 'craft',
    lens: `You are a design director reviewing three candidate art directions. Lens: CRAFT AND DISTINCTIVENESS. Would an experienced designer look at this and think "template / generated", or "a team with a point of view made this"? Judge typography (a real decision, hierarchy, numeric alignment), rhythm and alignment, restraint, whether uniformity was broken on purpose, whether anything is boxed or decorated without need. Compare against the tells in research.md one by one.`,
  },
  {
    key: 'operator',
    lens: `You are an on-call engineer at a messaging company who will use this console at 3 am during an incident. Lens: OPERATIONAL USEFULNESS. From each Overview screenshot, in five seconds, can you tell whether traffic is flowing, whether the queue is growing, whether the carrier limit is being hit, whether money is consistent? In the message list, can you scan status and attempts down the column? In the detail view, can you reconstruct what happened to the message in order? In the send form, is the cost and the reason for it obvious? Penalise beauty that costs legibility, low contrast, tiny text, ambiguous labels, colour as the only signal.`,
  },
  {
    key: 'build',
    lens: `You are the frontend lead who must implement the winning direction in an existing Next.js + Tailwind v4 app in a few hours without breaking behaviour (live updates, URL filters, loading / empty / error states, responsive under 768 px, light and dark). Lens: BUILDABILITY AND ROBUSTNESS. Read each direction's tokens.css, app.css and notes.md as well as the screenshots. Which direction has a coherent, complete token system, holds up in BOTH themes (look at overview-alt.png), will survive real data (long tenant names, 0 values, 5-digit counts, 200 rows, a 10-segment message), and has states that are easy to derive? Penalise directions that only work for the exact mock data or rely on fragile hand-placed pixels.`,
  },
]

phase('Mock')
const mocks = await parallel(DIRECTIONS.map(d => () =>
  agent(MOCK_TASK(d), { label: `mock:${d.name}`, phase: 'Mock', model: 'opus' }).then(report => ({ key: d.key, name: d.name, report }))))
const done = mocks.filter(Boolean)
log(`mock-ups finished: ${done.map(m => m.name).join(', ')}`)

phase('Judge')
const verdicts = await parallel(JUDGES.map(j => () =>
  agent(`${j.lens}

Context: an internal operations console for an SMS gateway. The current screens (the "before", which the owner called AI slop) are in ${D}\\current\\ . The research on generated-looking UI is ${D}\\research.md . The requirements the designers were given:
${BRIEF}

The three candidates are in ${D}\\a (Ledger), ${D}\\b (Console), ${D}\\c (Signal). For EACH, Read the images overview.png, overview-alt.png, messages.png, detail.png and send.png (all five; do not judge from one), and read notes.md. Look closely: zoom in mentally on alignment, contrast and text size. Do not edit anything and do not run git.

Score each direction 1 to 10 through your lens, with concrete strengths and weaknesses that name what you saw (which screen, which element). Pick one winner. Then say which specific ideas from the other two should be grafted into the winner, and which flaws of the winner must be fixed when it is built for real. Be decisive; do not hedge with ties.`,
    { label: `judge:${j.key}`, phase: 'Judge', schema: SCORES, model: 'opus' }).then(v => v && ({ judge: j.key, ...v }))))

const votes = verdicts.filter(Boolean)
const totals = { a: 0, b: 0, c: 0 }
const wins = { a: 0, b: 0, c: 0 }
for (const v of votes) {
  wins[v.winner] += 1
  for (const s of v.scores) totals[s.direction] += s.score
}
const ranked = Object.keys(totals).sort((x, y) => (wins[y] - wins[x]) || (totals[y] - totals[x]))
const winner = ranked[0]
log(`winner: ${winner} (wins ${JSON.stringify(wins)}, totals ${JSON.stringify(totals)})`)
return { winner, wins, totals, votes, reports: done.map(m => ({ key: m.key, name: m.name, report: String(m.report).slice(0, 1500) })) }

```

## What the sub-agents returned

Some reports below stop in the middle of a sentence. The script itself cut them (`.slice(0, N)`) before it returned them to the main session; nothing was cut when this file was made.

### winner

```text
a
```

### wins

```json
{
  "a": 2,
  "b": 1,
  "c": 0
}
```

### totals

```json
{
  "a": 22,
  "b": 20,
  "c": 20
}
```

### votes

```json
[
  {
    "judge": "craft",
    "scores": [
      {
        "direction": "a",
        "score": 8,
        "strengths": "The only one of the three that reads as a team with a point of view, not as a well-dressed dashboard. Typography carries the hierarchy. Plex Sans is used for words and Plex Mono for every figure, with one 30px sentence per screen and everything else at 11-15px, so the jump in size makes the headline the primary element (Overview: 'Traffic is flowing at 46.2 submits/s...'; Detail: 'Delivered to +971506701448 in 9.17 s, on the second submit attempt.'; Send: '3 segments in UCS-2, 0.0120 USD.'). There are no containers at all. Grouping comes from the 184px hanging margin column, a 1.5px ink rule that opens each section, hairlines between rows, and a statement-style double rule above Total in the tenants table and the Send cost list. That is restraint with a reason. Money is set to 4 decimals in tabular mono, so 239.9000, 920.8800 and 1,160.7800 align on the decimal, and so does the Messages COST USD column. Status is a word plus a geometric mark (hollow square, half circle, slashed circle, diamond, filled square), with circles for the carrier side and squares for ours. That is a real system, not tinted pills. The pipeline strip is labelled directly with leader lines and uses hatch and dot-screen fills instead of a legend. Colour is genuinely scarce: vermilion appears only on the oldest queued age, dead webhooks, Failed, the 503 attempt and the UCS-2 character. The detail history adds an italic gap row ('8.39 s with the carrier') and a 'where the time went' strip, which is the specific, product-true thinking the research asks for. Light theme as warm paper and dark as warm soot both avoid zinc. Copy is specific throughout ('Times are when the API accepted the message', 'Echoed back in the webhook').",
        "weaknesses": "(1) Overview throughput chart: the step line and the receipt bars share one y-axis labelled 50/46/40/0. The 40-to-0 stretch is compressed into a few pixels, so the axis is non-linear and lies. 'bars from zero' is a note apologising for it. (2) Monochrome status is too quiet where it matters. On Messages, the single Undelivered row (15:57:51.081) differs from the others only by a 9px slashed circle versus a filled circle, and a scanning eye misses it. Carrier-side failures get no weight or ink change. (3) The per-tenant OUTCOMES micro-strips in the tenants table are about 120px wide. The hatch and dot screen are unreadable at that size and become decoration. (4) The margin labels 'OVERVIEW' and 'MESSAGES' restate the active nav tab, which is the generic-copy tell. The 'Messages / MESSAGE' breadcrumb on Detail is the same. (5) The selected row on Messages has a left bar and a fill that run past the table's left edge, about 14px into the gutter, which breaks the one shared left edge the whole system depends on. (6) Message IDs are cut with an ellipsis ('01a20e47-242d...') and are not styled as links, so there is no affordance to open the detail. (7) In the Overview ledger list, the label and the value are both vermilion ('Oldest queued ... 81.4 s'), which doubles the accent where one would do. (8) In dark, the Delivered mass of the pipeline strip becomes a near-white 1100px bar and is the loudest thing on the screen, which inverts the intended quiet good case. (9) The time strip on Detail has no seconds axis, so 0.781 versus 8.393 is only a proportion with no scale."
      },
      {
        "direction": "b",
        "score": 7,
        "strengths": "Committed and coherent. It is truly square (0 radius), the near-black is warm (#12110f), the amber accent works like a phosphor, and every element sits on a character grid. The pipeline-by-tenant table merges counts, balances and ledger under group headers ('IN PROGRESS ->', 'FINAL · CHARGED', 'REFUNDED'), and is the most information-dense correct answer to the Overview question. The status mark system is smart: the fill rises with pipeline progress, and the carrier-side failures share a hue but differ in shape. Derived facts an operator acts on: '6 spare', 'drains in ~ 2m 21s', 'axis starts at 30' stated honestly on the chart, and 'Without it the text is 146 GSM-7 characters: 1 segment, $0.0040 instead of $0.0120'. Detail has the best history log: +S/UTC/SOURCE/RECORD/DETAIL/REF, the '----- 0.303 s backoff before retry' and '8.393 s with the carrier' gap rows, and a one-line outcome sentence with the 503 in accent. On Messages, a selected-row inspector pane below the table gives a peek without navigating, and a key bar at the bottom of every page gives the console a real working method. Send highlights the matched price row (+880 Bangladesh, 'matches +8801711000001') and adds a per-unit ruler under each segment.",
        "weaknesses": "Mono for everything is itself a recognisable generated-console costume, the 'terminal aesthetic' that tools produce when told 'not SaaS'. It also breaks the research's call for a face with character for UI text. Labels, nav, prose-like hints and data are all 11-12px Plex Mono, so apart from the two display numbers (amber '44', '6,468') there is almost no typographic hierarchy, and long stretches read with equal weight. Uppercase letterspaced section labels appear on every block (CARRIER SUBMITS, DISPATCH QUEUE, PIPELINE BY TENANT, WEBHOOKS, EXCEPTIONS, PRICES), so uniformity is the texture. A coloured square precedes every status everywhere (Messages has 13 green squares in a column), which is the always-on coloured-dot tell in another shape. The bottom of Overview is three roughly equal columns (Webhooks / Exceptions / Prices), not a deliberate asymmetric split. The amber accent is spent on too many things (the big number, key hints, 'space load 50 more', the cursor bar, the send button, the chart line), so it stops meaning 'attention'. 'EXCEPTIONS' lists a DELIVERED message. The chart draws two jagged lines with similar weight, and 'finalized' is a grey zigzag that adds noise. Dark-first plus mono is the most expected combination for an 'ops console'."
      },
      {
        "direction": "c",
        "score": 6,
        "strengths": "Confident scale contrast. The 112px semi-condensed Archivo '46.2/s' and the '3 segments' figure are real display decisions, and the wdth axis is a thoughtful choice. The throughput chart is the best-crafted chart of the three: one scale (40-50), the carrier limit as a hard 3px line, headroom as a flat tint, a step line, and direct labels at the line ends ('Carrier limit 50', 'Pacing target 46', 'Submitted 44 now') with no legend or grid. Overview uses a genuine 8+4 split. On Detail, the queued 0.78 s versus carrier 8.39 s time strip sits on a real seconds axis with ticks. Message IDs split into a bright prefix and a dim suffix, and timestamps dim their milliseconds, which is careful mono detailing. Messages adds a date group row ('Tuesday 24 Nov 2026 · 14 messages in view') and a TEXT column. Send has the most practical cost block (a rate card with the matched +880 row bolded under a rule, and 'Charged to ShopFast now. Refunded if it fails before the carrier.') and the clearest button copy ('Send 3 segments · $0.0120').",
        "weaknesses": "It is the closest to a competent default dashboard. Archivo at regular weight in the tables reads almost like Inter, so the 'typographic decision' only shows at display sizes. It opens with literal page titles 'Overview', 'Messages' and 'Send a test message' plus restating subtitles, exactly the generic-copy tell. The solid black header band with the logo block is the 'decorative logo block' pattern. Colour is loud rather than scarce: solid status fields above the pipeline columns act as a coloured legend; the 'Dead 3' is a solid orange box; 'UCS-2' is a solid orange badge; Detail opens with a big solid green 'Delivered' banner (a pill badge at banner size); history rows carry a 6px coloured spine; and the time strip is a saturated blue bar. That is at least seven saturated hues on the light ground. The All tenants row sets its counts at about 28px while the per-tenant rows are 16px, so the aggregate shouts and the rows an operator compares recede, the reverse of what the table is for. Zeros at 28px ('0 0 0') are the loudest marks in the pipeline. The 4px top rules on every section repeat as a uniform motif. The overview-alt dark render keeps the same structure but the headroom fill becomes a dark green slab."
      }
    ],
    "winner": "a",
    "graft": "From C: (1) Rebuild A's Overview throughput chart as C's: one honest y-scale (about 40-50), the carrier limit as the strongest line, headroom as a flat paper-sunk tint, and labels at the line ends. Move the finalized/receipt series to its own small strip with its own zero baseline instead of sharing an axis. (2) C's Detail time strip, with a seconds axis and tick marks under the queued/carrier split, added under A's 'where the time went' bar. (3) C's ID and timestamp detailing: ink-1 for the distinguishing prefix of message IDs (01a20e47-242d) with the rest in ink-3, ms in ink-3 in the TIME columns, and IDs styled as links on Messages instead of ellipsis-truncated plain text. (4) C's date group row on Messages ('Tuesday 24 Nov 2026 · 14 messages in view') and its TEXT column (truncated message body), which A lacks. (5) C's Send button copy ('Send 3 segments · $0.0120') and the consequence line next to it ('Charged to ShopFast now. Refunded if it fails before the carrier.'), plus the rate card with the matched prefix row emphasised under a rule. From B: (6) The keyboard layer: '/' to focus search, j/k row cursor, enter to open, esc back, [ ] for previous/next message on Detail, with hints set quietly in ink-3 rather than a full-width accent key bar. (7) B's selected-row inspector below the Messages table (text, status trail, attempts, carrier ID) for triage without navigating. (8) B's '0.303 s backoff before retry' gap row in the Detail history, in addition to A's existing 'with the carrier' gap row, and B's single outcome sentence naming the 503 refusal and 'Charged once'. (9) B's honest data-source caveat: label the dispatch-queue depth (6,468) and the per-status record counts as different sources, as both B and C did. (10) B's per-unit ruler idea on the Send segment split, but drawn as A's thin ink fill rather than a dotted cell row.",
    "must_fix": "1. The Overview throughput chart uses a non-linear shared axis (50/46/40/0 with the bars squeezed into the bottom). Fix it with one linear scale per series and drop the 'bars from zero' apology. 2. Carrier-side failures are invisible in the Messages table: Undelivered and Expired differ from Delivered only by a 9px mark. Give non-delivered outcomes a weight change (word at 500 or 600) and keep Delivered at 400, so the exceptions stand out in greyscale without adding colour. Consider marks at 10-11px. 3. The selected row (and its left bar) on Messages bleeds past the shared left content edge into the gutter. Keep the highlight inside the column grid, or hang the bar exactly in the margin column by design. 4. Remove the margin labels that restate the nav ('OVERVIEW', 'MESSAGES', and 'Messages / MESSAGE' on Detail). Use the margin for something specific (snapshot time, the count, the status key) or leave it empty. 5. The per-tenant OUTCOMES micro-strips are too small for hatch and dot fills to read. Either widen them to at least 200px with direct percentage labels, or drop them since the columns already carry the numbers. 6. In the Overview ledger list, colour only the value (81.4 s, 3), not the label as well, so vermilion stays the scarcest ink. 7. Dark theme: the Delivered mass of the pipeline strip renders near-white and becomes the loudest element. Use ink-2 or a mid-tone for the good case in dark so attention stays on vermilion. 8. Write the headline-sentence rules for every state (flowing / backing up / stalled / carrier refusing / ledger mismatch), with a fixed maximum length, so the 30px sentence never wraps past three lines or reflows on each tick. Hold numbers in tabular mono inside it so live updates do not shift words. 9. Build tables with baseline alignment and padding-based row height. Do not use shadcn's align-middle or fixed h-10 rows, which would break sans/mono baseline sharing. Keep 4-decimal money everywhere a column is compared, and right-align with tabular-nums. 10. Verify the 11px letterspaced caps labels and ink-3 text in both themes at AA (the notes claim 5.1:1 and 5.3:1). Do not let any caption fall to 10px. 11. Fonts in the real app: @fontsource/ibm-plex-sans (400, 500, 600, 400-italic) and @fontsource/ibm-plex-mono (400, 500) imported in app/layout.tsx, with no Google Fonts link."
  },
  {
    "judge": "operator",
    "scores": [
      {
        "direction": "b",
        "score": 8,
        "strengths": "Best incident tool of the three. Overview fits on one 1440x900 screen and answers all four questions: amber '44 /s' with 'of 50/s carrier limit · 6 spare' directly under it, a chart with a dashed 'limit 50' line, the dispatch queue showing 6,468 with 'oldest waiting 81.35 s' and 'drains in ≈ 2m 21s', and a merged pipeline-by-tenant table whose last column reads 'balanced' with '0 DOUBLE CHARGES' in the header. The EXCEPTIONS panel ('refused by carrier, charged', 'delivered on attempt 2') points you at what to look at next. Messages: DELIVERED is set in muted text, so the one coral UNDELIVERED row stands out when you run your eye down the column. ATT=2 is highlighted. The header shows 'DELIVERED 13 / UNDELIVERED 1'. Selecting a row opens an inline preview of its history and attempts without leaving the list. Detail: the outcome sentence ('carrier refused the first submit with 503; the retry 302 ms later was accepted. Charged once, $0.0210') rebuilds the story in one line. The log table (+s, UTC, source, record, detail, ref) has gap rows ('0.303 s backoff before retry', '8.393 s with the carrier'), and a time-split bar labels whose side each part of the time was on. Send: 'one character forces UCS-2' names U+1F4E6, segment 2, unit 51, and adds 'without it ... 1 segment, $0.0040 instead of $0.0120', which is the clearest explanation of cost. The matched +880 price row is highlighted. Keyboard bar, ctrl-u to strip non-GSM characters. Dark is the default, which suits 3 am.",
        "weaknesses": "Almost everything is 11-12 px mono, much of it uppercase. This is small for tired eyes, and the faint grey text ('axis starts at 30', 'end of loaded rows', the units in the chart legend) is near the edge of readable on #12110f. In the carrier-submits chart, the grey 'finalized' line zigzags across the amber submitted line and reads as noise. The axis starting at 30 exaggerates the swings. Dead webhooks ('3', red) sit in a small row at the bottom left, so the one actionable item on the page is not prominent. DELIVERED and UNDELIVERED both use a filled square and differ only by colour (the word does carry it). Amber is used for the active tab, key hints, the submitted line, the big number and 'oldest waiting', so it stops meaning 'act'. Nothing shows whether the queue is growing or shrinking. The tenant table shows QUEUED 0 while the queue shows 6,468, and neither says where its number comes from."
      },
      {
        "direction": "c",
        "score": 7,
        "strengths": "The most legible type: 14 px sans in tables, large figures, solid black text. The 46.2/s figure has 'Carrier limit 50 / Pacing target 46.0 / Headroom 3.8' beside it, and the chart shades headroom under a hard 3 px limit line, so 'are we hitting the limit' reads in one glance. Dead webhooks get a solid orange '3' block plus '3 dead after retries. Review and redeliver.', the clearest call to action in any direction. Ledger shows 'Consistent' with its formula ('opening − charges + refunds = balance'). Messages: Undelivered is bold with an amber square, and ATT 2 is bold, so both columns can be scanned. Detail: a time strip on a real seconds axis (0.78 s queued, 8.39 s with the carrier) and a coloured spine that follows the status in effect. Send: the button reads 'Send 3 segments · $0.0120', with 'Charged to ShopFast now. Refunded if it fails before the carrier.' next to it. The cost table and rate card bold the matched +880 row.",
        "weaknesses": "The 112 px display numerals and oversized pipeline-table figures push the per-tenant rows to the bottom edge at 1440x900, so the money and tenant breakdown does not fit on one screen. The overview has no exceptions or recent-failures list. In detail, the failed attempt 1 ('Carrier unavailable, HTTP 503 TEMPORARY_FAILURE') gets no colour or weight and looks like any other row, which is exactly where the eye needs to stop. There is no one-sentence summary of what happened. Small 11-12 px labels in ink-3 on the cool grey #E7EAED ground look washed out. The amber Undelivered square has weak contrast against the light ground. Light is the default for a tool used at night, and no queue trend is shown."
      },
      {
        "direction": "a",
        "score": 6,
        "strengths": "The overview headline answers the question in plain words: 'Traffic is flowing at 46.2 submits/s, inside the carrier's 50/s limit. 6,468 messages are queued and the oldest has waited 81.4 s'. It is followed by drain time, dead webhooks and 'ledger is balanced'. The dotted-leader fact list (Queue depth, Oldest queued, Webhooks dead, Ledger Balanced, Double charges 0) is a good at-a-glance checklist. Money columns have 4 decimals in mono and align on the decimal. Detail is the best chronological reconstruction: 'Delivered to +971506701448 in 9.17 s, on the second submit attempt', a time-split bar, and history rows where 'Unavailable, HTTP 503' is in vermilion with an italic '8.39 s with the carrier' gap row. Messages adds a 'FINAL IN S' column and a status key in the margin. Send leads with '3 segments in UCS-2, 0.0120 USD' and explains the cause precisely ('U+1F4E6 at character 118 ... drops from 153 to 67 units').",
        "weaknesses": "Status is carried by 9 px glyphs of the same ink colour: a filled circle for Delivered and a slashed circle for Undelivered. In Messages the one Undelivered row is almost invisible when scanning, which fails the main list task. Only Failed gets colour. Lots of 11-13 px text in ink-3 grey ('reached the handset', 'carrier refused, charged', chart labels), and the pipeline strip hangs leader lines off a 13 px Failed segment. The prose headline depends on threshold-generated wording that can mislead during an incident and takes longer to read than a number. Message IDs are truncated with an ellipsis. There is no exceptions list. Light is the default for 3 am use. In dark mode the per-tenant outcome strips are pale and hard to read."
      }
    ],
    "winner": "b",
    "graft": "From C: (1) Make dead webhooks an action block, not a table row: a solid signal-colour count plus a 'dead after retries, review and redeliver' line, with the 'r replay webhook' key next to it. (2) C's throughput chart: the limit drawn as a hard line, headroom as a flat tint, and direct labels 'Carrier limit 50 / Pacing target 46 / Submitted 44 now'. Draw finalized as a separate rug or bar strip, not a crossing line. (3) The send button copy 'Send 3 segments · $0.0120' with 'Charged to <tenant> now. Refunded if it fails before the carrier.' (4) The detail time strip on a real seconds axis. (5) Bold weight on non-delivered status words and on ATT > 1 as a second, non-colour cue. (6) C's ledger line that shows the formula 'opening − charges + refunds = balance' next to 'Consistent'. From A: (1) A one-line verdict at the top of Status ('Flowing, 46.2/s, inside 50/s; 6,468 queued, oldest 81.4 s; ledger balanced'), built from agreed thresholds. (2) The dotted-leader fact list with 'Webhooks dead' and 'Double charges 0' shown explicitly. (3) A's 'FINAL IN S' column on Messages. (4) A's shape grammar (circles for carrier-path states, squares for our-side states), so every status has a distinct mark. (5) The italic gap row and vermilion failed-attempt row style in history.",
    "must_fix": "1) Raise the base data size from 12 px to at least 13-14 px, and set message text and tenant names in sans at 14 px. Limit uppercase mono to column headers only. 2) Raise fg-faint so every label (chart units, 'axis starts at 30', 'end of loaded rows', group headers) is clearly above 4.5:1 on both #12110f and the selected-row background. Check this in real rendering, not only in the token math. 3) Give DELIVERED and UNDELIVERED different mark shapes (today both are a filled square), so status does not depend on colour where the word is truncated or the reader is colour-blind. 4) Reserve amber for 'needs attention'. Move the active tab, key hints and the submitted chart line to fg or a neutral colour, so 'oldest waiting 81.35 s' and dead webhooks are the only things that light up. Define thresholds for when 'oldest waiting' turns to attention. 5) Clean up the throughput chart: remove the jagged finalized line crossing the submitted line, and either start the axis at 0 or make the truncated axis unmissable. 6) Add a queue-depth trend (sparkline or Δ over the last 60 s) next to 6,468, so 'is the queue growing' can be answered at all. Right now none of the directions answers it. 7) Make dead webhooks prominent on Status (see graft) instead of a small red row in the bottom-left. 8) Resolve or label the contradiction between QUEUED 0 in the tenant table and the dispatch queue's 6,468 (snapshot source and time on each number). 9) Label the big '44 /s' as the latest 1 s sample, with the 60 s mean next to it, so operators do not misread a single dip. 10) Check that the light theme keeps the coral, blue and green status colours at AA as text, and keep the keyboard layer accessible (focus management, announcements when the j/k cursor moves)."
  },
  {
    "judge": "build",
    "scores": [
      {
        "direction": "a",
        "score": 8,
        "strengths": "Smallest and most coherent token system of the three: paper/paper-sunk, ink/ink-2/ink-3, rule/rule-strong, one attention colour. Status is derived from those roles (finals = ink, in progress = ink-2, FAILED = attention) and carried by a shape mark plus a word, so there are only about 8 colour values to get right per theme. overview-alt.png proves it: the dark set is a straight swap. The pipeline bar inverts cleanly, vermilion stays legible and the dotted leaders and double total rule survive. Layout is a two-column grid (184px margin column + 1fr) with no fixed viewport height, so 200 Messages rows simply scroll and a 10-segment message on Send just adds more 'SEGMENT n / units / bar' rows, which is a pattern that already repeats. Row height comes from padding (--row-pad), which gives you a density knob for free. Every money value is 4-decimal mono and right-aligned (Tenants table, Send totals, Messages COST USD), so decimals line up with nothing tuned by hand. The margin column collapses naturally to stacked labels under 768px. Light default plus prefers-color-scheme plus data-theme override is exactly what Next.js needs. Detail's history is a plain table with one italic gap row ('8.39 s with the carrier'), easy to build from a merged server query.",
        "weaknesses": "The pipeline strip's leader-line labels (Undelivered/Expired/Failed elbows on Overview) are placed by hand at 1440px, and the notes admit they need a ResizeObserver plus a collision pass. With other ratios (Failed at 0.1%, or Expired at 40%) they will cross. The OUTCOMES mini-strips in the Tenants table are about 120x4px, hatch and dot patterns unreadable at that size: decoration, not data. The headline sentence ('Traffic is flowing at 46.2 submits/s…') is the primary element of every screen but has no defined copy for stalled, disconnected, zero-traffic, loading or error, so state derivation is unspecified. The throughput chart's y-axis is non-linear (0, 40, 46, 50 spaced unevenly, with receipts bars 'from zero' sharing the axis). That is a hidden axis break that will mislead and is awkward to build. ink-3 is commented as 4.9:1 in tokens.css but 5.1:1 in notes.md, and it is used at 11-12px for subs. The dark block is duplicated (media query plus data-theme), which is a drift risk. Odd sizes (12.5px td.num, 11.5px sub.mono) sit outside the scale. Detail uses --paper-sunk for the message Text box, although the token is documented as 'only inputs and the selected row'. UNDELIVERED vs DELIVERED differ only by mark shape in identical ink: scanning 200 rows for failures is slow."
      },
      {
        "direction": "c",
        "score": 7,
        "strengths": "Best token completeness on paper. Status has separate fill (--st-*) and text (--st-*-text) roles, plus --on-dark-field/--on-light-field and an explicit hatch token. That is the right split for fields vs type, and dark re-values every one (overview-alt.png holds up well: green headroom tint, signal '3', field strip all read). The Messages table is the most conventional and therefore the most Tailwind-friendly: real text column, underlined ID link, preset range buttons (15 min/1 h/24 h/7 d), a 'Following new messages / Pause' live control and 'Load 50 older', which covers the live and pagination states explicitly. Detail's time strip sits on a real seconds axis and the coloured status spine beside the history is derivable from data. Send has a cost table and rate card with the matched row ruled, and a units bar per segment.",
        "weaknesses": "Robustness against real data is the weak point. The Overview tenant table sets counts at about 36px (18,252 / 20,488 already nearly fill their columns), so 7-digit counts or a third tenant will overflow or force a scroll at 1440, and it will collapse badly under 768. The status colour fields above the table headers are aligned to column geometry by hand. The 112px '46.2' figure changes width every tick (46.2 to 9.8 to 100.0), so with live updates the layout jitters despite tabular figures. The wdth 82 variable-axis setting needs a Tailwind plugin or arbitrary values throughout. td padding is 0, so every page sets its own row heights. Text tokens are incomplete: no --st-accepted-text or --st-queued-text. The black chrome band plus the 4px heavy rules give a lot of solid ink. The pipeline, the main 'is anything stuck' answer, falls below the fold on Overview. The detail headline badge is a solid green field with white text, close to a pill."
      },
      {
        "direction": "b",
        "score": 5,
        "strengths": "Clean, meaning-named tokens with a 5-hue status scale (idle/progress/ok/carrier/ours) and status marks as CSS masks coloured by currentColor. That is genuinely reusable, and the fill rising with progress plus a fixed 11ch word width makes status columns align by construction. Both themes hold (overview-alt.png: the amber deepened to #915300 still reads, greens and corals keep AA). Many good derived facts: '6 spare', 'drains in ≈ 2m 21s', '0.303 s backoff before retry' gap row, 'without the emoji: 1 segment, $0.0040'. td.zero faint styling for 0 values is a nice real-data touch. Pages are generated from data.json via build/gen.mjs.",
        "weaknesses": "The least robust to build. body is a fixed 36px/1fr/24px grid with overflow:hidden, and the Overview is a fixed 300px/1fr/400px grid sized for 1440x900 (the notes admit 7-digit counts or a third tenant break it). 200 Messages rows, the peek panel below the table, and a 10-segment Send preview have nowhere to go, and nothing works under 768px. Almost all text is 11-12px mono, including data, labels and chrome, which hurts legibility at speed and on screen-share. It ignores prefers-color-scheme by design. The keyboard layer (j/k cursor, numbered views, key bar on every page) is real engineering cost and fights Next.js routing and focus. The Send segment preview relies on a 7.2px per-unit ruler aligned to mono glyphs, which breaks on emoji and fonts that do not load. Balances are 2 decimals on Overview (239.90) but 4 on Send (920.8800). The hero '44 /s' is the last sample while the average is 46.15, two different 'now' numbers. The chart has hand-placed end labels and a translucent fill-opacity area."
      }
    ],
    "winner": "a",
    "graft": "From C: (1) split each status into fill and text roles (--st-x for marks and strips, --st-x-text for words) so FAILED/UNDELIVERED words can be strengthened later without touching marks. (2) Add the Messages live control: 'Following new messages' plus Pause, preset range buttons 15 min/1 h/24 h/7 d next to the From/To fields, a 'Load 50 older' button and 'N shown of 20,488'. These make the live, paginated and URL-filter states explicit. (3) Add a TEXT column (truncated, sans) and make the message ID an underlined link. (4) Add the rate card on Send with the matched prefix row ruled. (5) Put the 'Final · charged' / 'Final · refunded' group labels over the pipeline and tenant columns. From B: (1) dim zero cells (td.zero in --ink-3) so the 0/0/0 in-progress columns recede. (2) Give the status word a min-width of 11ch so status columns align by construction. (3) Use the 120ms value-change colour flash as the only live-update motion. (4) Copy the 'backoff before retry' gap row and the 'same client_ref run' idea into A's history. (5) Add a single '/' shortcut to focus search, and drop the rest of the keyboard layer. (6) Generate fixtures from data.json as B's gen.mjs does, so long-name, 0-value, 7-digit and 200-row cases can be rendered and checked.",
    "must_fix": "1. Replace the hand-placed leader-line labels on the pipeline strip with a deterministic layout. Use a fixed label row in pipeline order (Delivered | Undelivered | Expired | Failed), each label with its own mark, and the bar above. Give each bar segment a minimum width (for example 3px) so tiny segments stay visible. No elbows and no collision routing. 2. Drop or enlarge the 4px OUTCOMES mini-strips in the Tenants table; at that size the hatch and dot patterns are noise. 3. Specify the headline sentence as a state table before building: flowing, backing up (oldest queued past threshold), at limit, stalled (0 submits with queue > 0), stream disconnected, loading (skeleton sentence in ink-3 with no numbers), error (the sentence states the failure and when data was last seen), and empty or zero traffic. Do the same for the Detail and Send headlines (Send with an empty text field: '0 segments'). 4. Fix the throughput chart axis: either a true linear 0–50 scale, or two separate panels (submits 40–50 with a marked axis break, receipts 0–50). Never one uneven axis shared by both. 5. Make UNDELIVERED and EXPIRED words findable when scanning 200 rows. Keep the mark, and add weight 500/600 or the planned --st-*-text role so they differ from DELIVERED by more than a 9px glyph. 6. Define the responsive rules under 768px: margin column stacks above content, Masthead nav wraps, the Messages table scrolls horizontally inside a wrapper with time and status pinned, the Tenants table drops OPENING/USED/% to a details row, and the Send preview moves under the form. 7. Single-source the dark theme: generate the media-query block and the [data-theme=dark] block from one list (Tailwind v4 @custom-variant dark plus @theme mapping) so they cannot drift. 8. Reconcile and verify contrast. tokens.css says ink-3 is 4.9:1 and notes.md says 5.1:1. Measure it, and raise it to at least 5:1 if it is used at 11–12px. Remove the off-scale 12.5px and 11.5px sizes. 9. Stop using --paper-sunk for the read-only message text on Detail; add a separate --paper-quote role or use a left rule. 10. Do not let shadcn/Tailwind table primitives add align-middle or a fixed h-10. Keep vertical-align: baseline with padding-based rows, add a compact --row-pad for the 200-row view, and use a sticky header. 11. Show long-tenant-name behaviour: truncate with title in the Messages tenant column, and wrap the display name with the slug on its own line in the Tenants table."
  }
]
```

### reports

```json
[
  {
    "key": "a",
    "name": "Ledger",
    "report": "I built Direction A, \"Ledger\", in light by default: tokens.css, app.css, the four static pages, the five renders and notes.md. I did three full critique-and-fix rounds and would put my name on the result. All five PNGs are 1440x900 viewport renders and use only the data in data.json.\n\n**What I made**\n- **The look:** warm off-white paper (#F5F3EC) with near-black ink. Section names hang in a 184 px margin column, each section opens with an ink rule, and there are no cards. Totals sit under a double rule.\n- **Fonts:** IBM Plex Sans for words and IBM Plex Mono for every figure, ID, phone number and timestamp, with tabular figures and slashed zero. Money always has 4 decimals, so columns line up on the decimal point. The npm packages are `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-mono`.\n- **Accent:** one vermilion, used only for the oldest queued age (81.4 s), the 3 dead webhooks, FAILED, the refused submit attempt and the 📦 character that forces UCS-2.\n- **Status:** a word plus a 9 px geometric mark on the text baseline. Circles are the carrier path, squares are our side:\n  - Accepted: hollow square\n  - Queued: hollow circle\n  - Submitted: half-filled circle\n  - Delivered: filled circle\n  - Undelivered: circle with a slash\n  - Expired: hollow diamond\n  - Failed: filled square in the accent\n- **Contrast:** all text passes AA in both themes. The quietest text is 5.1:1 on light and 5.3:1 on dark.\n\n**The four pages**\n- **Overview:** headline \"Traffic is flowing at 46.2 s"
  },
  {
    "key": "b",
    "name": "Console",
    "report": "Direction B, \"Console\", is finished: all four pages are built and rendered at 1440x900, dark by default plus a light render of the Status page. I took it through three critique-and-fix rounds against the ban list and stopped when I would put my name on it. Every number comes from data.json; the pages are generated from it by build/gen.mjs.\n\n**What it looks like**\n- **Colour:** a warm near-black (#12110f) with one amber accent. The accent is used only for the live series, the cursor row, the active tab, key hints and attention values. All other colour is semantic.\n- **Type:** IBM Plex Mono for every value, label and the display numbers; IBM Plex Sans only for prose and message text. The npm packages are `@fontsource/ibm-plex-mono` and `@fontsource/ibm-plex-sans`. The mock links Google Fonts only so the render shows the real faces.\n- **Layout:** no cards anywhere. Each section is an uppercase label on a 1px rule, all radii are 0, and there are no shadows or gradients. Every page has a top bar with numbered tabs, connection state and a dark/light switch, and a key bar at the bottom.\n- **Status:** each status is a 10px square mark plus its word, set 11 characters wide so status columns stay aligned. The fill rises with progress:\n  - ACCEPTED is hollow; QUEUED is a third filled; SUBMITTED two thirds; DELIVERED fully filled.\n  - UNDELIVERED is a filled coral square; EXPIRED is a coral diagonal half.\n  - FAILED is a red hollow square with a cross.\n  - DELIVERED words stay muted; exc"
  },
  {
    "key": "c",
    "name": "Signal",
    "report": "All four \"Signal\" screens are built and rendered at 1440 x 900: Overview, Messages, Message detail and Send test. Light is the default, and Overview is also rendered dark. Every page fits the viewport with real data from data.json, and I looked at each PNG after rendering it.\n\n**What I made**\n- **Look:** a black header band, a cool grey background (#E7EAED) and no cards anywhere. Sections are separated only by rules (4 px above a section label, 2 px under table heads, 1 px between rows), small uppercase labels and space. The grid is 12 columns, split 8 + 4, 4 + 8 or 5 + 7 depending on the screen.\n- **Fonts:** Archivo (`@fontsource-variable/archivo`, imported via `wdth.css` for the width axis) for text and figures, with the large numbers semi-condensed. IBM Plex Mono (`@fontsource/ibm-plex-mono`) for message IDs, phone numbers, times and segment text. Numbers in columns use tabular figures with fixed decimals, so the decimal points line up.\n- **Status:** each status is a solid colour block plus its word, never colour alone. In-progress states are grey, slate and blue; Delivered is a deep green. Undelivered is amber and Expired is the same amber with a diagonal hatch, since both are carrier-side and charged. Failed uses the one orange attention colour, because it is our fault and refunded; non-delivered outcomes are also set in bold.\n- **The attention colour appears only where an operator should act:** 3 dead webhooks, the UCS-2 warning, and Failed.\n- **Overview:**\n  - The main"
  }
]
```
