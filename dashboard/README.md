# Dashboard

The internal console of the SMS gateway: a live overview, the message list, the
full history of one message and a form to send a test message.

Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, TanStack Query,
nuqs, Recharts and zod.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

The dashboard needs the gateway. Start it first, or point `GATEWAY_URL` at one
that is running. Without a gateway every data region shows its error state with
a Retry button, and the connection indicator in the top bar says "Reconnecting".
If the gateway goes away while a page is open, the page keeps its last data and
says from when it is.

| Variable      | Default                 | Meaning                                               |
| ------------- | ----------------------- | ----------------------------------------------------- |
| `GATEWAY_URL` | `http://localhost:8000` | Base URL of the gateway. Read by the server only      |
| `ADMIN_TOKEN` | `dev-admin-token`       | Sent as `X-Admin-Token`. It never reaches the browser |
| `PORT`        | `3000`                  | Port of the dashboard server                          |

For `npm run dev`, copy `.env.example` to `.env.local`. The production server
reads them from its environment.

| Script              | What it does                                                  |
| ------------------- | ------------------------------------------------------------- |
| `npm run dev`       | Development server with hot reload                            |
| `npm run build`     | Production build into `.next/standalone`                      |
| `npm run start`     | Runs the production build (`node .next/standalone/server.js`) |
| `npm run lint`      | ESLint with the Next.js rules                                 |
| `npm run typecheck` | `tsc --noEmit`                                                |
| `npm run test`      | Unit tests (Vitest)                                           |
| `npm run format`    | Prettier                                                      |

The Docker image is built from this directory alone (`docker build .`) and runs
the same standalone server as `npm run start`, as the unprivileged `node` user.

## Structure

```
src/
  app/
    (console)/               the four pages, inside the shell (sidebar, top bar)
      page.tsx               /               Overview
      messages/page.tsx      /messages       Message list
      messages/[id]/page.tsx /messages/:id   Message detail
      send/page.tsx          /send           Send test message
    api/gateway/[...path]/   server-side proxy to the gateway's internal API
    providers.tsx            theme, query client, URL state, live stream
    globals.css              design tokens (light and dark), status colours
  components/
    ui/                      small primitives: button, badge, card, field, table, tooltip ...
    layout/                  navigation, connection indicator, theme toggle, page header
    overview/                pipeline strip, stat tiles, throughput chart, tenant cards
    messages/                filter bar, table, list hook, event buffer, live update rules
    message-detail/          facts, timeline and the function that merges it
    send/                    form, live preview, result card, idempotent send hook
  lib/
    api/                     zod schemas, fetch client, endpoints, query keys, hooks
    live/                    stream connection, provider, what "stats" events update
    sms-encoding.ts          port of gateway/src/gateway/encoding.py
    pricing.ts               longest-prefix price lookup
    format.ts                money (micros), durations, timestamps (local time, with the offset)
    message-filters.ts       list filters and how they match a message
    validation.ts            the gateway's input rules, for inline form errors
    status.ts                the seven statuses, in pipeline order
```

## How the browser reaches the gateway

The browser only calls `/api/gateway/*` on the dashboard's own origin. The route
handler in `src/app/api/gateway/[...path]/route.ts` forwards the request to
`${GATEWAY_URL}/internal/*`, adds the admin token and passes the response body
through as a stream. If the gateway can not be reached it answers `502` with the
code `GATEWAY_UNREACHABLE`, in the gateway's own error shape.

Every response is parsed with a zod schema from `src/lib/api/schemas.ts`, which
follows `docs/API.md`. A response that does not match is shown as an error, with
the path and the field that is wrong. It is never rendered half-parsed.

## How live updates work

There is one `EventSource` for the whole app, opened by `LiveProvider` on
`/api/gateway/stream`. The proxy passes Server-Sent Events through unbuffered
and closes the upstream connection when the browser goes away.

- **Connection state.** `connecting`, `live` or `reconnecting`, shown in the top
  bar. On an error, or after 10 seconds without any event (the gateway sends
  `stats` every second), the connection is closed and opened again with
  exponential backoff: 1 s up to 15 s, with jitter.
- **Every time the stream opens** every query is invalidated: after a
  reconnect, and also after the first connect. The stream is best-effort, so
  whatever happened before the subscription existed is fetched again over REST.
- **`stats` events** update two things. Tenant balances and counts are written
  into the TanStack Query cache, and the tenants query only polls (every 15
  seconds) while the stream is not live. Queue numbers and throughput points
  are kept beside the cache and merged into the overview when it is read. They
  are not written into the overview query, because that query polls every 15
  seconds at all times (webhook totals and the billing check are not on the
  stream) and a cache write restarts the poll timer.
- **`message` events** go to whoever subscribed with `useLiveEvent`:
  - the message list collects them in a buffer and applies them ten times a
    second, and not while a list request is running, because the answer to
    that request would overwrite them. A row that is loaded is patched and
    flashes. A message that is newer than the first row and matches the
    current filters is only counted in the "N new messages" pill, so the list
    never moves under the user. The pill, or Refresh, loads a fresh first
    page. The pill tracks up to 1,000 messages one by one and shows "1,000+"
    beyond that. While the stream is down the loaded pages are polled every 15
    seconds instead;
  - the detail page and the result card on the send page refetch the message
    when the event is about it. The stream only reports status changes, so
    the detail also polls: every 2 seconds while the message is not final, an
    attempt is in flight or a webhook is pending, every 15 seconds after that.
- **`batch` events** add their `count` to the pill, once per batch.

## SMS preview

`src/lib/sms-encoding.ts` is a port of `gateway/src/gateway/encoding.py`. Both
are tested against `shared/encoding-vectors.json`, so the preview on the send
page shows the encoding, segment count and cost that the gateway will charge,
without a network call. The price comes from `GET /internal/prices` (loaded
once) with the longest matching prefix.

The send form creates an `Idempotency-Key` when a draft is first submitted and
reuses it for every later submit of the same draft. After a failure that makes
a retry safe. After a success it makes a double click or a held Enter key
harmless: the gateway replays its stored answer and charges nothing. While the
result of a draft is showing, the form does not submit that draft again. A
changed draft gets a new key, and "Clear result" drops the key so the same
draft can be sent again on purpose.
