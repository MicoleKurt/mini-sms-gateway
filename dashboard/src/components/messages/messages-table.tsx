"use client";

import { useRouter } from "next/navigation";
import { Fragment, useCallback, useState, type ReactNode } from "react";
import type { Message } from "@/lib/api/schemas";
import { formatCount, sharedIdPrefix } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { NoteRow, Table, Td, Th, Tr } from "@/components/ui/table";
import { arrivedSince, groupByUtcDay } from "./list-format";
import { MessageRow } from "./message-row";
import styles from "./messages-table.module.css";

interface Column {
  label: string;
  /** The full name of a head shortened to fit, for a tooltip and assistive technology. */
  full?: string;
  numeric?: boolean;
  pin?: boolean;
  /** Held at the right edge while the table scrolls sideways on a phone. */
  stuck?: boolean;
  /** Width of the placeholder while loading, close to the real content. */
  skeleton: string;
  /** Column width in px, padding included. Text has none: it takes what is left. */
  width?: number;
}

// In the order of the cells in MessageRow. Fixed widths, so the columns do
// not move when the filters change or a row with longer values arrives.
const COLUMNS: Column[] = [
  { label: "Time UTC", pin: true, skeleton: "w-24", width: 104 },
  { label: "Message", skeleton: "w-24", width: 160 },
  { label: "Tenant", skeleton: "w-16", width: 104 },
  { label: "To", skeleton: "w-24", width: 120 },
  { label: "From", skeleton: "w-12", width: 82 },
  { label: "Text", skeleton: "w-40" },
  { label: "Status", stuck: true, skeleton: "w-20", width: 122 },
  { label: "Enc.", full: "Encoding", skeleton: "w-10", width: 60 },
  { label: "Seg.", full: "Segments", numeric: true, skeleton: "w-3", width: 48 },
  { label: "Cost", numeric: true, skeleton: "w-12", width: 72 },
  { label: "Att.", full: "Submit attempts", numeric: true, skeleton: "w-3", width: 48 },
  { label: "Final in s", numeric: true, skeleton: "w-8", width: 78 },
];

const SKELETON_ROWS = 14;

function SkeletonRows() {
  return Array.from({ length: SKELETON_ROWS }, (_, row) => (
    <tr key={row}>
      {COLUMNS.map(({ label, numeric, skeleton }) => (
        <Td key={label}>
          <Skeleton className={`h-2.5 ${skeleton} ${numeric ? "ml-auto" : ""}`} />
        </Td>
      ))}
    </tr>
  ));
}

/**
 * The rows that arrived since the list was last shown, so they can fade in.
 * A new list (other filters) starts with none.
 */
function useArrivals(messages: Message[], listKey: string): ReadonlySet<string> {
  const newestAt = messages[0]?.created_at ?? null;
  const [seen, setSeen] = useState({
    listKey,
    newestAt,
    arrived: new Set<string>() as ReadonlySet<string>,
  });
  if (seen.listKey !== listKey || seen.newestAt !== newestAt) {
    const arrived =
      seen.listKey === listKey ? arrivedSince(messages, seen.newestAt) : new Set<string>();
    setSeen({ listKey, newestAt, arrived });
  }
  return seen.arrived;
}

interface MessagesTableProps {
  messages: Message[];
  /** Identifies the filtered list, so switching filters is not mistaken for arrivals. */
  listKey: string;
  loading: boolean;
  /** Shown in the body in place of the rows: the empty or the error state. */
  placeholder?: ReactNode;
}

/**
 * The message table: one group row per UTC day, then one row per message.
 * The head sticks to the top of the page while it scrolls. Under 768 px the
 * table scrolls sideways inside its wrapper.
 */
export function MessagesTable({ messages, listKey, loading, placeholder }: MessagesTableProps) {
  const router = useRouter();
  const arrived = useArrivals(messages, listKey);
  const sharedId = sharedIdPrefix(messages.map((message) => message.id));

  const open = useCallback(
    (id: string, inNewTab: boolean) => {
      const href = `/messages/${id}`;
      if (inNewTab) window.open(href, "_blank", "noopener");
      else router.push(href);
    },
    [router],
  );

  return (
    <Table scrollX className={styles.table} aria-busy={loading}>
      <caption className="sr-only">Messages, newest first. Times are UTC.</caption>
      <colgroup>
        {COLUMNS.map(({ label, width }) => (
          <col key={label} style={width ? { width } : undefined} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {COLUMNS.map(({ label, full, numeric, pin, stuck }) => (
            <Th
              key={label}
              numeric={numeric}
              pin={pin}
              className={stuck ? styles.stuck : undefined}
            >
              {full ? (
                <abbr title={full} className="no-underline">
                  {label}
                </abbr>
              ) : (
                label
              )}
            </Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <SkeletonRows />
        ) : placeholder ? (
          <NoteRow colSpan={COLUMNS.length}>{placeholder}</NoteRow>
        ) : (
          groupByUtcDay(messages).map((group) => (
            <Fragment key={group.day}>
              <Tr variant="group">
                <td colSpan={COLUMNS.length}>
                  {group.label}
                  <span className="font-normal text-ink-2">
                    {" "}
                    · {formatCount(group.messages.length)}{" "}
                    {group.messages.length === 1 ? "message" : "messages"} in view
                  </span>
                </td>
              </Tr>
              {group.messages.map((message) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  arriving={arrived.has(message.id)}
                  sharedId={sharedId}
                  onOpen={open}
                />
              ))}
            </Fragment>
          ))
        )}
      </tbody>
    </Table>
  );
}
