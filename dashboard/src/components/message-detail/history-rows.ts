/**
 * The rows of a message's history table: every status event, submit
 * attempt, delivery receipt, ledger entry and webhook record in time order,
 * with a gap row wherever a noticeable pause has an explanation
 * ("0.303 s backoff before retry", "8.39 s with the carrier").
 */
import type {
  AttemptOutcome,
  DlrReceipt,
  LedgerEntry,
  MessageDetail,
  StatusEvent,
  SubmitAttempt,
  WebhookDelivery,
} from "@/lib/api/schemas";
import { epochMicros, formatAmount, formatDuration } from "@/lib/format";
import type { MessageStatus } from "@/lib/status";
import {
  attention,
  code,
  figure,
  formatSeconds,
  joinWithDots,
  millisBetween,
  words,
  type Phrase,
} from "./phrase";
import { buildTimeline } from "./timeline-items";

/** A pause shorter than this is not worth a row of its own. */
export const GAP_MS = 250;

export interface EventRow {
  kind: "event";
  key: string;
  /** When it happened, or null for a state with no time (a webhook that is pending or dead). */
  at: string | null;
  /** Milliseconds after accept. */
  sinceMs: number | null;
  source: string;
  /** For a status event: the status, set as mark and word. */
  status: MessageStatus | null;
  what: Phrase;
  detail: Phrase;
  /** A failed submit or a dead webhook: set in the attention ink. */
  failed: boolean;
  /** Used to explain the pause after this row. */
  role: "queued" | "submitted" | "refused" | "receipt" | "webhook-answered" | null;
  /** When the thing this row records ended, if later than `at` (an attempt's answer). */
  endAt: string | null;
}

export interface GapRow {
  kind: "gap";
  key: string;
  text: string;
}

export type HistoryRow = EventRow | GapRow;

const OUTCOME_WORDS: Record<AttemptOutcome, string> = {
  ACCEPTED: "Accepted by carrier",
  RATE_LIMITED: "Rate limited",
  UNAVAILABLE: "Unavailable",
  REJECTED: "Rejected",
  TIMEOUT: "No answer in time",
  ABANDONED: "Abandoned without an answer",
};

const DETAIL_KEYS_SHOWN_ELSEWHERE = new Set(["carrier_id", "dlr_status", "carrier_timestamp"]);

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The time of day in an ISO string as written, keeping its microseconds: "15:58:02.240788". */
function clockAsWritten(iso: string): string {
  return /T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/.exec(iso)?.[1] ?? iso;
}

function statusRow(event: StatusEvent): Omit<EventRow, "kind" | "sinceMs"> {
  const facts: Phrase[] = [];
  for (const [key, value] of Object.entries(event.detail)) {
    if (DETAIL_KEYS_SHOWN_ELSEWHERE.has(key)) continue;
    if (key === "carrier_error" && value === event.detail.reason) continue;
    if (key === "attempt") facts.push([words(`attempt ${String(value)}`)]);
    else if (key === "http_status") facts.push([words(`HTTP ${String(value)}`)]);
    else facts.push([words(`${key.replaceAll("_", " ")} `), code(String(value))]);
  }
  facts.push([words(`event ${event.id}`)]);
  return {
    key: `status-${event.id}`,
    at: event.occurred_at,
    source: "Status",
    status: event.status,
    what: [],
    detail: joinWithDots(facts),
    failed: false,
    role: event.status === "QUEUED" ? "queued" : event.status === "SUBMITTED" ? "submitted" : null,
    endAt: null,
  };
}

function ledgerRow(entry: LedgerEntry): Omit<EventRow, "kind" | "sinceMs"> {
  return {
    key: `ledger-${entry.id}`,
    at: entry.created_at,
    source: "Ledger",
    status: null,
    // Signed as a debit; the verb says which way the money went.
    what: [
      words(entry.kind === "CHARGE" ? "Charged " : "Refunded "),
      figure(formatAmount(Math.abs(entry.amount_micros))),
    ],
    detail: joinWithDots([
      [words("balance after "), figure(formatAmount(entry.balance_after_micros))],
      [words(`entry ${entry.id}`)],
    ]),
    failed: false,
    role: null,
    endAt: null,
  };
}

function attemptRow(attempt: SubmitAttempt): Omit<EventRow, "kind" | "sinceMs"> {
  const failed = attempt.outcome !== null && attempt.outcome !== "ACCEPTED";
  const outcome = attempt.outcome === null ? "In flight" : OUTCOME_WORDS[attempt.outcome];
  const http = attempt.http_status === null ? "" : `, HTTP ${attempt.http_status}`;
  const took =
    attempt.finished_at === null
      ? null
      : formatDuration(millisBetween(attempt.started_at, attempt.finished_at));

  return {
    key: `attempt-${attempt.attempt_no}`,
    at: attempt.started_at,
    source: `Attempt ${attempt.attempt_no}`,
    status: null,
    what: [failed ? attention(outcome + http) : words(outcome + http)],
    detail: joinWithDots([
      ...(attempt.error ? [[failed ? attention(attempt.error) : code(attempt.error)]] : []),
      [words(attempt.worker_id)],
      ...(took ? [[words(took)]] : []),
    ]),
    failed,
    role: failed ? "refused" : null,
    endAt: attempt.finished_at,
  };
}

function receiptRow(receipt: DlrReceipt): Omit<EventRow, "kind" | "sinceMs"> {
  return {
    key: `dlr-${receipt.id}`,
    at: receipt.received_at,
    source: "Receipt",
    status: null,
    what: [code(receipt.status), words(` from carrier, ${receipt.disposition.toLowerCase()}`)],
    detail: joinWithDots([
      [words("carrier time "), figure(clockAsWritten(receipt.carrier_timestamp))],
      [words(`receipt ${receipt.id}`)],
    ]),
    failed: false,
    role: "receipt",
    endAt: null,
  };
}

function webhookRows(delivery: WebhookDelivery): Omit<EventRow, "kind" | "sinceMs">[] {
  const queued: Omit<EventRow, "kind" | "sinceMs"> = {
    key: `webhook-${delivery.id}`,
    at: delivery.created_at,
    source: "Webhook",
    status: null,
    what: [words("Queued for tenant")],
    detail: [code(delivery.url)],
    failed: false,
    role: null,
    endAt: null,
  };
  const lastAnswer = [
    ...(delivery.last_http_status === null ? [] : [[words(`HTTP ${delivery.last_http_status}`)]]),
    ...(delivery.last_error ? [[code(delivery.last_error)]] : []),
  ];
  const base = { source: "Webhook", status: null, endAt: null } as const;

  switch (delivery.status) {
    case "DELIVERED": {
      const took =
        delivery.delivered_at === null
          ? []
          : [[words(formatDuration(millisBetween(delivery.created_at, delivery.delivered_at)))]];
      return [
        queued,
        {
          ...base,
          key: `webhook-${delivery.id}-answer`,
          at: delivery.delivered_at,
          what: [
            words(
              delivery.last_http_status === null
                ? "Delivered"
                : `Delivered, HTTP ${delivery.last_http_status}`,
            ),
          ],
          detail: joinWithDots([[words(plural(delivery.attempts, "attempt"))], ...took]),
          failed: false,
          role: "webhook-answered",
        },
      ];
    }
    case "PENDING":
      return [
        queued,
        {
          ...base,
          key: `webhook-${delivery.id}-answer`,
          at: null,
          what: [
            words(
              delivery.attempts === 0
                ? "Not tried yet"
                : `Not answered after ${plural(delivery.attempts, "attempt")}`,
            ),
          ],
          detail: joinWithDots([
            ...lastAnswer,
            ...(delivery.next_attempt_at
              ? [
                  [
                    words("next try "),
                    figure(clockAsWritten(delivery.next_attempt_at).slice(0, 12)),
                  ],
                ]
              : []),
          ]),
          failed: false,
          role: null,
        },
      ];
    case "DEAD":
      return [
        queued,
        {
          ...base,
          key: `webhook-${delivery.id}-answer`,
          at: null,
          what: [attention(`Dead after ${plural(delivery.attempts, "attempt")}`)],
          detail: joinWithDots(lastAnswer),
          failed: true,
          role: null,
        },
      ];
  }
}

function gapText(before: EventRow, after: EventRow, ms: number): string {
  const span = formatSeconds(ms);
  if (before.role === "refused" && after.source.startsWith("Attempt")) {
    return `${span} backoff before retry`;
  }
  if (after.role === "receipt" || before.role === "submitted") return `${span} with the carrier`;
  if (before.role === "queued" || after.source === "Attempt 1")
    return `${span} waiting in the queue`;
  if (after.role === "webhook-answered") return `${span} until the tenant's endpoint answered`;
  return `${span} later`;
}

/** Every record of a message as history rows, oldest first, with explained gaps. */
export function buildHistory(detail: MessageDetail): HistoryRow[] {
  const acceptedAt = detail.message.created_at;
  const records = buildTimeline(detail).flatMap((item) => {
    switch (item.kind) {
      case "status":
        return [statusRow(item.event)];
      case "ledger":
        return [ledgerRow(item.entry)];
      case "attempt":
        return [attemptRow(item.attempt)];
      case "dlr":
        return [receiptRow(item.receipt)];
      case "webhook":
        return webhookRows(item.delivery);
    }
  });

  // A webhook's answer comes later than the records after its creation, and
  // a record without a time goes last. The sort is stable, so ties keep the
  // timeline's order.
  const timeOf = (row: { at: string | null }) =>
    row.at === null ? Number.POSITIVE_INFINITY : epochMicros(row.at);
  const ordered = records
    .map((row): EventRow => ({
      ...row,
      kind: "event",
      sinceMs: row.at === null ? null : millisBetween(acceptedAt, row.at),
    }))
    .sort((a, b) => (timeOf(a) === timeOf(b) ? 0 : timeOf(a) - timeOf(b)));

  const rows: HistoryRow[] = [];
  ordered.forEach((row, index) => {
    const previous = ordered[index - 1];
    if (previous && row.at !== null) {
      const ms = millisBetween(previous.endAt ?? previous.at!, row.at);
      if (ms >= GAP_MS)
        rows.push({ kind: "gap", key: `gap-${row.key}`, text: gapText(previous, row, ms) });
    }
    rows.push(row);
  });
  return rows;
}
