import { describe, expect, it } from "vitest";
import { deliveredOnRetry, withChanges } from "./fixtures";
import { buildHistory, type EventRow, type HistoryRow } from "./history-rows";
import { phraseText } from "./phrase";

function describeRow(row: HistoryRow): string {
  if (row.kind === "gap") return `-- ${row.text}`;
  const what = row.status ?? phraseText(row.what);
  return `${row.source}: ${what} | ${phraseText(row.detail)}`;
}

describe("buildHistory", () => {
  const rows = buildHistory(deliveredOnRetry);

  it("merges every record in time order, with the pauses explained", () => {
    expect(rows.map(describeRow)).toEqual([
      "Status: ACCEPTED | event 81654",
      "Status: QUEUED | event 81655",
      "Ledger: Charged 0.0210 | balance after 240.0040 · entry 20706",
      "Attempt 1: Unavailable, HTTP 503 | TEMPORARY_FAILURE · w-72a97779 · 133 ms",
      "-- 0.303 s backoff before retry",
      "Attempt 2: Accepted by carrier, HTTP 200 | w-72a97779 · 303 ms",
      "Status: SUBMITTED | attempt 2 · event 81675",
      "-- 8.39 s with the carrier",
      "Receipt: DELIVRD from carrier, applied | carrier time 15:58:02.240788 · receipt 22581",
      "Status: DELIVERED | event 81710",
      "Webhook: Queued for tenant | http://127.0.0.1:9100/hooks/acme-bank",
      "Webhook: Delivered, HTTP 200 | 1 attempt · 47 ms",
    ]);
  });

  it("measures each record from accept", () => {
    const events = rows.filter((row): row is EventRow => row.kind === "event");
    expect(events[0]?.sinceMs).toBe(0);
    expect(events.at(-1)?.sinceMs).toBeCloseTo(9222.009, 6);
  });

  it("marks the refused attempt, and only it, as failed", () => {
    const failed = rows.filter((row) => row.kind === "event" && row.failed);
    expect(failed.map((row) => row.key)).toEqual(["attempt-1"]);
  });

  it("puts a dead webhook last, without a time, in the attention ink", () => {
    const dead = {
      ...deliveredOnRetry.webhooks[0]!,
      status: "DEAD" as const,
      attempts: 6,
      last_http_status: 500,
      delivered_at: null,
    };
    const last = buildHistory(withChanges({}, { webhooks: [dead] })).at(-1) as EventRow;
    expect(describeRow(last)).toBe("Webhook: Dead after 6 attempts | HTTP 500");
    expect(last).toMatchObject({ at: null, sinceMs: null, failed: true });
  });

  it("names a long wait in the queue", () => {
    // Accepted, queued and charged five seconds before the first submit.
    const earlier = (iso: string) => iso.replace("15:57:53.07", "15:57:48.07");
    const waited = withChanges(
      { created_at: earlier(deliveredOnRetry.message.created_at) },
      {
        events: deliveredOnRetry.events.map((event) => ({
          ...event,
          occurred_at: earlier(event.occurred_at),
        })),
        ledger: deliveredOnRetry.ledger.map((entry) => ({
          ...entry,
          created_at: earlier(entry.created_at),
        })),
      },
    );
    const texts = buildHistory(waited)
      .filter((row) => row.kind === "gap")
      .map((row) => (row.kind === "gap" ? row.text : ""));
    expect(texts[0]).toBe("5.04 s waiting in the queue");
  });
});
