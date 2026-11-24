import { StatusWord } from "@/components/ui/status";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { TimeOfDay } from "@/components/ui/time-of-day";
import type { EventRow, HistoryRow } from "./history-rows";
import { PhraseText } from "./phrase-text";

function sinceAccept(ms: number): string {
  return `+${(ms / 1_000).toFixed(3)}`;
}

function Event({ row }: { row: EventRow }) {
  return (
    <Tr>
      <Td mono pin className="text-small">
        {row.at === null ? <span className="zero">–</span> : <TimeOfDay at={row.at} />}
      </Td>
      <Td numeric wideOnly className="text-small text-ink-2">
        {row.sinceMs === null ? <span className="zero">–</span> : sinceAccept(row.sinceMs)}
      </Td>
      <Td wideOnly className="text-ink-2">
        {row.source}
      </Td>
      <Td className="font-medium">
        {/* On a phone the source column is gone; it heads the cell instead. */}
        <span className="show-narrow text-small font-normal text-ink-2">{row.source}</span>
        {row.status ? <StatusWord status={row.status} /> : <PhraseText phrase={row.what} />}
      </Td>
      <Td wrap className="min-w-48 text-small text-ink-2">
        <PhraseText phrase={row.detail} />
      </Td>
    </Tr>
  );
}

function Gap({ text }: { text: string }) {
  return (
    <Tr variant="gap">
      {/* On a phone the gap is told in the pinned first cell, where it stays in view. */}
      <td className="pin">
        <span className="show-narrow">{text}</span>
      </td>
      <td className="hide-narrow" />
      <td className="hide-narrow" />
      <td colSpan={2} className="hide-narrow">
        <span
          aria-hidden
          className="mr-2.5 inline-block h-[18px] w-0 border-l border-dashed border-ink-3 align-middle"
        />
        {text}
      </td>
    </Tr>
  );
}

/** The history as a real table: one row per record, a gap row where time passed. */
export function HistoryTable({ rows }: { rows: HistoryRow[] }) {
  return (
    <Table scrollX>
      <caption className="sr-only">History of the message, oldest first. Times are UTC.</caption>
      <thead>
        <tr>
          <Th pin>Time UTC</Th>
          <Th numeric wideOnly>
            Since accept
          </Th>
          <Th wideOnly>Source</Th>
          <Th>What happened</Th>
          <Th>Detail</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) =>
          row.kind === "gap" ? (
            <Gap key={row.key} text={row.text} />
          ) : (
            <Event key={row.key} row={row} />
          ),
        )}
      </tbody>
    </Table>
  );
}
