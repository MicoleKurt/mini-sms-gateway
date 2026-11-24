import { describe, expect, it } from "vitest";
import type { MessageDetail } from "@/lib/api/schemas";
import { buildTimeline } from "./timeline-items";

const detail: MessageDetail = {
  message: {
    id: "m1",
    tenant_id: "t1",
    tenant_name: "Acme Bank",
    batch_id: null,
    client_ref: "otp-1",
    to: "+8801711000001",
    from: "ACME",
    text: "Your code is 482913",
    encoding: "GSM7",
    segments: 1,
    cost_micros: 4_000,
    currency: "USD",
    status: "DELIVERED",
    attempts: 2,
    ambiguous_attempts: 0,
    carrier_id: "c-2",
    failure_reason: null,
    created_at: "2026-11-24T15:04:05.100000Z",
    submitted_at: "2026-11-24T15:04:05.700000Z",
    finalized_at: "2026-11-24T15:04:09.000000Z",
  },
  // Deliberately out of order: the timeline must not rely on the API's order.
  events: [
    { id: 4, status: "DELIVERED", occurred_at: "2026-11-24T15:04:09.000000Z", detail: {} },
    { id: 1, status: "ACCEPTED", occurred_at: "2026-11-24T15:04:05.100000Z", detail: {} },
    {
      id: 3,
      status: "SUBMITTED",
      occurred_at: "2026-11-24T15:04:05.700000Z",
      detail: { attempt: 2 },
    },
    { id: 2, status: "QUEUED", occurred_at: "2026-11-24T15:04:05.100450Z", detail: {} },
  ],
  attempts: [
    {
      attempt_no: 1,
      worker_id: "w-1",
      started_at: "2026-11-24T15:04:05.200000Z",
      finished_at: "2026-11-24T15:04:05.300000Z",
      outcome: "UNAVAILABLE",
      http_status: 503,
      carrier_id: null,
      error: "TEMPORARY_FAILURE",
    },
    {
      attempt_no: 2,
      worker_id: "w-2",
      started_at: "2026-11-24T15:04:05.518000Z",
      finished_at: "2026-11-24T15:04:05.700000Z",
      outcome: "ACCEPTED",
      http_status: 200,
      carrier_id: "c-2",
      error: null,
    },
  ],
  dlrs: [
    {
      id: 7,
      carrier_id: "c-2",
      status: "DELIVRD",
      carrier_timestamp: "2026-11-24T15:04:08Z",
      received_at: "2026-11-24T15:04:08.990000Z",
      disposition: "APPLIED",
    },
  ],
  ledger: [
    {
      id: 1,
      kind: "CHARGE",
      amount_micros: 4_000,
      balance_after_micros: 249_996_000,
      created_at: "2026-11-24T15:04:05.100000Z",
    },
  ],
  webhooks: [
    {
      id: "wh-1",
      url: "http://webhook-sink:9100/hooks/acme-bank",
      status: "DELIVERED",
      attempts: 1,
      last_http_status: 200,
      last_error: null,
      created_at: "2026-11-24T15:04:09.000100Z",
      delivered_at: "2026-11-24T15:04:09.200000Z",
      next_attempt_at: null,
    },
  ],
};

describe("buildTimeline", () => {
  const timeline = buildTimeline(detail);

  it("merges every record, oldest first", () => {
    expect(timeline.map((item) => item.key)).toEqual([
      "status-1",
      "ledger-1",
      "status-2",
      "attempt-1",
      "attempt-2",
      "status-3",
      "dlr-7",
      "status-4",
      "webhook-wh-1",
    ]);
  });

  it("orders records that are less than a millisecond apart", () => {
    const keys = timeline.map((item) => item.key);
    expect(keys.indexOf("status-1")).toBeLessThan(keys.indexOf("status-2"));
    expect(keys.indexOf("status-4")).toBeLessThan(keys.indexOf("webhook-wh-1"));
  });

  it("gives each status the time since the previous status", () => {
    const deltas = timeline.flatMap((item) =>
      item.kind === "status" ? [item.sincePreviousMs] : [],
    );
    expect(deltas).toEqual([null, 0.45, 599.55, 3_300]);
  });

  it("gives a finished attempt its duration and leaves an open one without", () => {
    const [first, second] = timeline.flatMap((item) => (item.kind === "attempt" ? [item] : []));
    expect(first?.durationMs).toBe(100);
    expect(second?.durationMs).toBe(182);

    const inFlight = buildTimeline({
      ...detail,
      attempts: [{ ...detail.attempts[0]!, finished_at: null, outcome: null, http_status: null }],
    });
    expect(inFlight.find((item) => item.kind === "attempt")).toMatchObject({ durationMs: null });
  });
});
