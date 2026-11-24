# UI primitives (Ledger)

Paper ground, ink type, rules instead of boxes. Plex Sans for words, Plex Mono
for every figure, ID, phone number and time. Colour only carries meaning.

Tokens live in `src/app/globals.css`; base classes in `src/styles/*.css`.
Check colour changes with `npm run check:contrast`.

## Tokens as utilities

| Kind                              | Utilities                                                                                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ground                            | `bg-paper`, `bg-paper-sunk` (inputs, hovered or selected row, chart headroom only)                                                                          |
| Ink                               | `text-ink`, `text-ink-2`, `text-ink-3`                                                                                                                      |
| Rules                             | `border-rule` (hairline), `border-rule-strong` (section rule, ink)                                                                                          |
| Status fill (marks, strips, bars) | `bg-st-queued`, `fill-st-delivered`, ... one per status                                                                                                     |
| Status text (words)               | `text-st-queued-text`, `text-st-failed-text`, ...                                                                                                           |
| Attention                         | `text-attention` (a value that crossed a threshold), `bg-attention-fill`, `bg-attention-wash`                                                               |
| Chart                             | `stroke-chart-submitted`, `stroke-chart-limit`, `stroke-chart-target`, `fill-chart-headroom`, `fill-chart-receipts`, `stroke-chart-grid`, `fill-chart-axis` |
| Time strip                        | `bg-time-gateway`, `bg-time-carrier`, `bg-time-tenant`                                                                                                      |
| Pipeline strip                    | `bg-strip-ground` behind hatching; expired is `--st-expired` hatching on it                                                                                 |
| Type scale                        | `text-label` 11, `text-small` 12, `text-body` 13, `text-lead` 15, `text-figure` 24, `text-display` 30. Nothing else.                                        |
| Radius                            | `rounded-control` (2 px), only on things you press or type into                                                                                             |

In SVG, `fill="var(--st-delivered)"` works as well. Tailwind's default palette,
type sizes, radii and shadows are switched off.

## Classes

| Class                       | Use                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------- |
| `num` / `mono`              | Tabular mono figures. Inside `.headline`, `num` keeps Plex Sans with tabular figures. |
| `unit`                      | The words of a figure ("s", "USD") in sans, also inside a mono cell                   |
| `lbl`                       | 11 px caps label (column heads, field labels, section names)                          |
| `headline`, `headline-wide` | The one 30 px sentence per screen; `<b>` for the verdict                              |
| `lede`                      | The 15 px line under the headline                                                     |
| `attn`                      | The attention value (only the value, never its label)                                 |
| `zero`                      | A dimmed zero or not-applicable value                                                 |
| `figure`, `figure-mid`      | 24 px and 15 px mono figures with a `<small>` unit                                    |
| `quote`                     | Message text quoted on Detail: a left rule, no fill                                   |
| `hide-narrow`               | Hidden under 768 px                                                                   |
| `show-narrow`               | Shown only under 768 px, where it stands in for a hidden column                       |
| `flash`                     | 120 ms ink flash (use `<LiveValue>` instead of setting it)                            |

## Components

```tsx
<Section label="Pipeline" context="Message records, all tenants">...</Section>
<Section ruled={false} context={<TimeOfDay at={now} />}>{/* first section of a page */}</Section>

<StatusWord status="UNDELIVERED" />            // mark + word, min-width 11ch
<StatusWord status="QUEUED" muted />            // a status with a count of zero: ink-3, no colour
<StatusMark status="FAILED" />                  // mark alone (pair it with a word)

<Figure value="46.2" unit="/s mean" />          // size="mid" for the 15 px figure
<FigureText text="9.222 s" />                   // numbers mono, units sans, one line
<Money micros={239_900_000} />                  // 239.9000; currency="USD" adds the unit
<Count value={0} />                             // 1,234,567; zero is dimmed
<MessageId id={id} href={`/messages/${id}`} shared={sharedIdPrefix(ids)} shownLength={18} />
<TimeOfDay at={message.created_at} />           // 16:13:35.412 in UTC; millis={false}
<LiveValue value={depth}><Count value={depth} /></LiveValue>   // flashes on change

<FactsList label="Key figures">
  <Fact label="Queue depth" note="−86 in 60 s · live"><Count value={6468} /></Fact>
  <Fact label="Oldest queued" attention><FigureText text="81.4 s" /></Fact>
  <Fact label="Ledger, 2 tenants" words>Balanced</Fact>
</FactsList>

<PropertyList>
  <Property label="To"><span className="num">+971506701448</span> <small>+971 UAE</small></Property>
</PropertyList>

<Table compact scrollX>                         // compact: long lists; scrollX: sideways under 768 px
  <thead><tr><Th pin>Accepted</Th><Th numeric>Cost USD</Th><Th wideOnly numeric>%</Th></tr></thead>
  <tbody>
    <Tr variant="group"><td colSpan={3}>Tuesday 24 Nov 2026 · 14 messages in view</td></Tr>
    <Tr hoverable selected={open} arriving={isNew}>
      <Td pin><TimeOfDay at={m.created_at} /></Td>
      <Td numeric><Money micros={m.cost_micros} /></Td>
      <Td clip title={m.tenant_name}>{m.tenant_name}</Td>
    </Tr>
    <Tr variant="total">...</Tr>                 // double rule above
    <Tr variant="gap"><td /><td colSpan={2}>8.39 s with the carrier</td></Tr>
    <NoteRow colSpan={3}><EmptyState title="..." /></NoteRow>
  </tbody>
</Table>
// Td also takes mono (left-aligned mono), zero, wrap (breaks long URLs anywhere).

<Button variant="primary">Send 3 segments · 0.0120 USD</Button>
<Button variant="secondary">Load 50 older</Button>
<Button variant="quiet">Clear</Button>        // sizes: md (default), sm
<Link className={buttonClasses({ variant: "secondary" })} href="/">...</Link>
<CopyButton value={id} label="Copy ID" />

<Field htmlFor="to" label="To" hint="Bangladesh, +880" error={error}>
  <Input id="to" className="mono" aria-describedby={fieldMessageId("to")} />
</Field>
<Select id="tenant">...</Select>
<Textarea id="text" />
<PresetGroup label="Time range" options={RANGES} value={range} onChange={setRange} />

<LoadingState label="Loading tenants" lines={2} />   // inside .headline the lines are display size
<SkeletonText lines={3} /> <Skeleton className="h-2 w-48" /> <LoadingLabel>Loading</LoadingLabel>
<EmptyState title="No messages match these filters." description="Widen the time range." action={<Button variant="quiet">Clear filters</Button>} />
<ErrorState title="Tenants could not be loaded" error={query.error} onRetry={() => query.refetch()} />
<RefreshFailedNotice title="Tenants could not be refreshed" query={query} />
<Alert tone="danger" title="The message was not sent">...</Alert>
<Tooltip content="...">...</Tooltip>
```

## Rules of thumb

- No cards, no boxes, no tinted pills, no shadows, no gradients. Group with `<Section>`.
- Do not put a section label that repeats the nav tab; use the margin for real context or leave it empty.
- Money that is compared is `<Money>` (4 decimals), right-aligned in a `numeric` cell.
- A figure and its unit go through `<FigureText>`: a space after a mono figure reads as a double gap.
- The selected or hovered row stays inside the grid; do not add bars or negative margins.
- Times are UTC and the head or sentence says so.
- The only motion is `<LiveValue>` and `<Tr arriving>`. Both respect reduced motion.
