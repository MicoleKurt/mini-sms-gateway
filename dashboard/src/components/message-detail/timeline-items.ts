import type {
  DlrReceipt,
  LedgerEntry,
  MessageDetail,
  StatusEvent,
  SubmitAttempt,
  WebhookDelivery,
} from "@/lib/api/schemas";
import { epochMicros } from "@/lib/format";

export type TimelineItem =
  | { kind: "status"; key: string; at: string; event: StatusEvent; sincePreviousMs: number | null }
  | { kind: "attempt"; key: string; at: string; attempt: SubmitAttempt; durationMs: number | null }
  | { kind: "dlr"; key: string; at: string; receipt: DlrReceipt }
  | { kind: "ledger"; key: string; at: string; entry: LedgerEntry }
  | { kind: "webhook"; key: string; at: string; delivery: WebhookDelivery };

// For two records with the same timestamp: the status change reads first.
const KIND_ORDER: Record<TimelineItem["kind"], number> = {
  status: 0,
  ledger: 1,
  attempt: 2,
  dlr: 3,
  webhook: 4,
};

function millisecondsBetween(earlier: string, later: string): number {
  return (epochMicros(later) - epochMicros(earlier)) / 1_000;
}

/**
 * Merge everything the gateway recorded about a message into one history,
 * oldest first. Status events carry the time since the previous status, so
 * the path through the state machine can be read with its timing.
 */
export function buildTimeline(detail: MessageDetail): TimelineItem[] {
  const statusEvents = [...detail.events].sort(
    (a, b) => epochMicros(a.occurred_at) - epochMicros(b.occurred_at),
  );

  const items: TimelineItem[] = [
    ...statusEvents.map((event, index): TimelineItem => {
      const previous = statusEvents[index - 1];
      return {
        kind: "status",
        key: `status-${event.id}`,
        at: event.occurred_at,
        event,
        sincePreviousMs: previous
          ? millisecondsBetween(previous.occurred_at, event.occurred_at)
          : null,
      };
    }),
    ...detail.attempts.map((attempt): TimelineItem => ({
      kind: "attempt",
      key: `attempt-${attempt.attempt_no}`,
      at: attempt.started_at,
      attempt,
      durationMs: attempt.finished_at
        ? millisecondsBetween(attempt.started_at, attempt.finished_at)
        : null,
    })),
    ...detail.dlrs.map((receipt): TimelineItem => ({
      kind: "dlr",
      key: `dlr-${receipt.id}`,
      at: receipt.received_at,
      receipt,
    })),
    ...detail.ledger.map((entry): TimelineItem => ({
      kind: "ledger",
      key: `ledger-${entry.id}`,
      at: entry.created_at,
      entry,
    })),
    ...detail.webhooks.map((delivery): TimelineItem => ({
      kind: "webhook",
      key: `webhook-${delivery.id}`,
      at: delivery.created_at,
      delivery,
    })),
  ];

  return items.sort(
    (a, b) => epochMicros(a.at) - epochMicros(b.at) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
  );
}
