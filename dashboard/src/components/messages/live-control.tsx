"use client";

import { formatCount } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import type { NewCount } from "./live-list";

function newMessagesLabel({ count, orMore }: NewCount): string {
  if (orMore) return count === 0 ? "new messages" : `${formatCount(count)}+ new messages`;
  return count === 1 ? "1 new message" : `${formatCount(count)} new messages`;
}

interface LiveControlProps {
  live: boolean;
  onLiveChange: (live: boolean) => void;
  /** The stream is down and the list is read again every 15 seconds instead. */
  polling: boolean;
  newCount: NewCount;
  onShowNew: () => void;
  refreshing: boolean;
  onRefresh: () => void;
}

/**
 * The line above the table: whether the list follows the stream, Pause or
 * Resume, and the notice for messages that arrived above the loaded rows.
 * New rows are counted, never inserted, so the list does not move under the
 * reader. The line has a fixed height, so the notice does not push it either.
 */
export function LiveControl({
  live,
  onLiveChange,
  polling,
  newCount,
  onShowNew,
  refreshing,
  onRefresh,
}: LiveControlProps) {
  const hasNew = newCount.count > 0 || newCount.orMore;
  const state = !live
    ? "Paused: rows keep the status they had"
    : polling
      ? "Stream down: reading the list again every 15 s"
      : "Statuses update live; new messages wait above the list";

  return (
    <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-6 gap-y-2">
      <div className="flex items-center gap-4">
        <p
          role="status"
          className={cn(
            "font-medium",
            !live ? "text-ink-2" : polling ? "text-st-queued-text" : "text-ink",
          )}
        >
          {state}
        </p>
        <Button size="sm" onClick={() => onLiveChange(!live)}>
          {live ? "Pause" : "Resume"}
        </Button>
      </div>
      <div className="flex items-center gap-5">
        {hasNew ? (
          <Button size="sm" onClick={onShowNew}>
            Show {newMessagesLabel(newCount)}
          </Button>
        ) : null}
        <Button variant="quiet" onClick={onRefresh} aria-disabled={refreshing}>
          Refresh
        </Button>
      </div>
      {/* The count on the button changes with every event. This says it once. */}
      <p role="status" className="sr-only">
        {hasNew ? "New messages are available. The Show button above the table loads them." : ""}
      </p>
    </div>
  );
}
