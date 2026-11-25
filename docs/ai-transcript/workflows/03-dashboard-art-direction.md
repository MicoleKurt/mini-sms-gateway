# Workflow 3: dashboard-art-direction

A workflow is a script that the main session wrote to run several sub-agents. The script below holds every prompt the sub-agents received. [Back to the index](../README.md).

| | |
|---|---|
| Started | 2026-11-25 00:18 (UTC+8) |
| Duration | 9.3 minutes |
| Sub-agents | 3 |
| Tool calls by sub-agents | 31 |
| Status | killed |
| Default model | claude-fable-5-2 |
| Run id | wf_8d7290ff-758 |

## Phases

- **Mock**: three art directions as real HTML, rendered and self-critiqued
- **Judge**: three judges score the screenshots from different points of view

## Summary

Three designers each build a rendered mock-up of the dashboard in a different art direction; three judges score the screenshots and a winner is chosen

## Script

```js
export const meta = {
  name: 'dashboard-art-direction',
  description: 'Three designers each build a rendered mock-up of the dashboard in a different art direction; three judges score the screenshots and a winner is chosen',
  phases: [
    { title: 'Mock', detail: 'three art directions as real HTML, rendered and self-critiqued' },
    { title: 'Judge', detail: 'three judges score the screenshots from different points of view' },
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
  agent(MOCK_TASK(d), { label: `mock:${d.name}`, phase: 'Mock' }).then(report => ({ key: d.key, name: d.name, report }))))
const done = mocks.filter(Boolean)
log(`mock-ups finished: ${done.map(m => m.name).join(', ')}`)

phase('Judge')
const verdicts = await parallel(JUDGES.map(j => () =>
  agent(`${j.lens}

Context: an internal operations console for an SMS gateway. The current screens (the "before", which the owner called AI slop) are in ${D}\\current\\ . The research on generated-looking UI is ${D}\\research.md . The requirements the designers were given:
${BRIEF}

The three candidates are in ${D}\\a (Ledger), ${D}\\b (Console), ${D}\\c (Signal). For EACH, Read the images overview.png, overview-alt.png, messages.png, detail.png and send.png (all five; do not judge from one), and read notes.md. Look closely: zoom in mentally on alignment, contrast and text size. Do not edit anything and do not run git.

Score each direction 1 to 10 through your lens, with concrete strengths and weaknesses that name what you saw (which screen, which element). Pick one winner. Then say which specific ideas from the other two should be grafted into the winner, and which flaws of the winner must be fixed when it is built for real. Be decisive; do not hedge with ties.`,
    { label: `judge:${j.key}`, phase: 'Judge', schema: SCORES }).then(v => v && ({ judge: j.key, ...v }))))

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

Nothing: the run was stopped before it returned.
