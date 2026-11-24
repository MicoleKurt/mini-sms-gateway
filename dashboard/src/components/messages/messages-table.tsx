"use client";

import { useRouter } from "next/navigation";
import { useCallback, type ReactNode } from "react";
import type { Message } from "@/lib/api/schemas";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, Td, Th } from "@/components/ui/table";
import { useNow } from "@/lib/use-now";
import { MessageRow, WIDE_ONLY } from "./message-row";

interface Column {
  label: string;
  /** Width of the placeholder while loading, close to the real content. */
  skeleton: string;
  align?: "right";
  wideOnly?: boolean;
}

// In the order of the cells in MessageRow. Status comes right after the time,
// so it is on screen on a phone without scrolling sideways.
const COLUMNS: Column[] = [
  { label: "Time (local)", skeleton: "w-24" },
  { label: "Status", skeleton: "w-20" },
  { label: "Tenant", skeleton: "w-24", wideOnly: true },
  { label: "To", skeleton: "w-28" },
  { label: "From", skeleton: "w-16", wideOnly: true },
  { label: "Encoding", skeleton: "w-12", wideOnly: true },
  { label: "Segments", skeleton: "w-4", align: "right", wideOnly: true },
  { label: "Cost", skeleton: "w-16", align: "right" },
  { label: "Attempts", skeleton: "w-4", align: "right" },
];

const SKELETON_ROWS = 12;

function SkeletonRows() {
  return Array.from({ length: SKELETON_ROWS }, (_, row) => (
    <tr key={row} className="border-b border-line last:border-b-0">
      {COLUMNS.map(({ label, skeleton, align, wideOnly }) => (
        <Td key={label} className={wideOnly ? WIDE_ONLY : undefined}>
          <Skeleton className={cn("h-4", skeleton, align === "right" && "ml-auto")} />
        </Td>
      ))}
    </tr>
  ));
}

interface MessagesTableProps {
  messages: Message[];
  loading: boolean;
  /** Shown under the header in place of the rows: the empty or the error state. */
  placeholder?: ReactNode;
}

/**
 * The message table. From 768 px up it has its own height and the header
 * stays in view while the body scrolls. Below that it is as tall as its rows
 * and the page scrolls, so a phone never has a scroll area inside another.
 */
export function MessagesTable({ messages, loading, placeholder }: MessagesTableProps) {
  const router = useRouter();
  const now = useNow(10_000);

  const open = useCallback(
    (id: string, inNewTab: boolean) => {
      const href = `/messages/${id}`;
      if (inNewTab) window.open(href, "_blank", "noopener");
      else router.push(href);
    },
    [router],
  );

  return (
    <>
      <Table
        containerClassName={placeholder ? undefined : "min-h-80 md:max-h-[calc(100dvh-19rem)]"}
        aria-busy={loading}
      >
        <caption className="sr-only">Messages, newest first</caption>
        <thead>
          <tr>
            {COLUMNS.map(({ label, align, wideOnly }) => (
              <Th key={label} align={align} className={wideOnly ? WIDE_ONLY : undefined}>
                {label}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows />
          ) : (
            messages.map((message) => (
              <MessageRow key={message.id} message={message} now={now} onOpen={open} />
            ))
          )}
        </tbody>
      </Table>
      {/* Outside the table, so it is centred in the card and not in a table that may be wider. */}
      {placeholder ? (
        <div className="flex min-h-80 items-center justify-center">{placeholder}</div>
      ) : null}
    </>
  );
}
