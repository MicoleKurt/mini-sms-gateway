import { describe, expect, it } from "vitest";
import type { Overview, ThroughputPoint } from "@/lib/api/schemas";
import { overviewHeadline, sentenceText, type HeadlineInput } from "./headline";

const NAMES = new Map([
  ["t1", "Acme Bank"],
  ["t2", "ShopFast"],
]);

/** Sixty seconds of submits ending at 15:55:59 UTC. */
function minute(submitted: number, finalized = submitted): ThroughputPoint[] {
  return Array.from({ length: 60 }, (_, second) => ({
    t: `2026-11-24T15:55:${String(second).padStart(2, "0")}Z`,
    submitted,
    finalized,
  }));
}

function overview(changes: Partial<Overview> = {}): Overview {
  return {
    queue: { depth: 6_468, oldest_age_ms: 2_140, in_flight: 14 },
    carrier: { limit_per_second: 50, target_per_second: 46 },
    throughput: minute(46),
    billing: [
      { tenant_id: "t1", consistent: true, double_charged: 0 },
      { tenant_id: "t2", consistent: true, double_charged: 0 },
    ],
    webhooks: { pending: 412, delivered: 9_871, dead: 0 },
    ...changes,
  };
}

const data = (changes: Partial<Overview> = {}): HeadlineInput => ({
  kind: "data",
  overview: overview(changes),
  tenantNames: NAMES,
});

const NBSP = " ";

describe("overviewHeadline", () => {
  it("loading: no sentence and no numbers", () => {
    expect(overviewHeadline({ kind: "loading" })).toEqual({
      state: "loading",
      sentence: [],
      lede: [],
    });
  });

  it("unreachable: says so, and when data was last seen", () => {
    const headline = overviewHeadline({
      kind: "unreachable",
      lastSeenAt: "2026-11-24T16:13:42.512Z",
    });
    expect(headline.state).toBe("unreachable");
    expect(sentenceText(headline.sentence)).toBe(
      "The gateway is not answering. Data was last seen at 16:13:42 UTC.",
    );
    expect(sentenceText(headline.lede)).toContain("not updating");
  });

  it("unreachable before any data arrived", () => {
    const headline = overviewHeadline({ kind: "unreachable", lastSeenAt: null });
    expect(sentenceText(headline.sentence)).toBe(
      "The gateway is not answering. No data has arrived since this page opened.",
    );
  });

  it("ledger mismatch names the tenant and wins over the traffic state", () => {
    const headline = overviewHeadline(
      data({
        queue: { depth: 10, oldest_age_ms: 90_000, in_flight: 2 },
        billing: [
          { tenant_id: "t1", consistent: true, double_charged: 0 },
          { tenant_id: "t2", consistent: false, double_charged: 0 },
        ],
      }),
    );
    expect(headline.state).toBe("ledger-mismatch");
    expect(sentenceText(headline.sentence)).toBe(
      "Ledger mismatch for ShopFast. Its balance no longer equals opening − charges + refunds.",
    );
    // The traffic moves to the lede.
    expect(sentenceText(headline.lede)).toMatch(/^The queue is backing up/);
    expect(headline.lede.some((part) => part.kind === "verdict")).toBe(false);
  });

  it("double charges count as a ledger mismatch", () => {
    const headline = overviewHeadline(
      data({
        billing: [
          { tenant_id: "t1", consistent: true, double_charged: 3 },
          { tenant_id: "t2", consistent: true, double_charged: 0 },
        ],
      }),
    );
    expect(headline.state).toBe("ledger-mismatch");
    expect(sentenceText(headline.sentence)).toBe(
      "Double charges for Acme Bank: 3 messages were charged twice.",
    );
  });

  it("stalled: a queue and no submits in the window", () => {
    const headline = overviewHeadline(
      data({ queue: { depth: 120, oldest_age_ms: 45_000, in_flight: 0 }, throughput: minute(0) }),
    );
    expect(headline.state).toBe("stalled");
    expect(sentenceText(headline.sentence)).toBe(
      `Submits have stopped. 120 messages are queued and none went to the carrier in the last 10 s; the oldest has waited 45.0${NBSP}s.`,
    );
    // No drain estimate when nothing drains.
    expect(sentenceText(headline.lede)).not.toContain("drains");
  });

  it("backing up: the oldest age is the one attention value", () => {
    const headline = overviewHeadline(
      data({ queue: { depth: 6_468, oldest_age_ms: 81_400, in_flight: 14 } }),
    );
    expect(headline.state).toBe("backing-up");
    expect(sentenceText(headline.sentence)).toBe(
      `The queue is backing up: the oldest of 6,468 queued messages has waited 1${NBSP}min 21${NBSP}s. Submits run at 46.0/s, inside the carrier’s 50/s limit.`,
    );
    const attention = headline.sentence.filter((part) => part.kind === "figure" && part.attention);
    expect(attention).toEqual([
      { kind: "figure", text: `1${NBSP}min 21${NBSP}s`, attention: true },
    ]);
  });

  it("flowing: rate against the limit, queue and its age, and the drain time", () => {
    const headline = overviewHeadline(data());
    expect(headline.state).toBe("flowing");
    expect(sentenceText(headline.sentence)).toBe(
      `Traffic is flowing at 46.0 submits/s, inside the carrier’s 50/s limit. 6,468 messages are queued and the oldest has waited 2.1${NBSP}s.`,
    );
    expect(sentenceText(headline.lede)).toBe(
      `At the 46/s target the queue drains in about 2${NBSP}min 21${NBSP}s. No webhook delivery is dead; the ledger is balanced for both tenants.`,
    );
  });

  it("flowing at the limit says so", () => {
    const headline = overviewHeadline(data({ throughput: minute(50) }));
    expect(sentenceText(headline.sentence)).toContain("at the carrier’s 50/s limit");
  });

  it("stalled as soon as the last 10 s had no submits, whatever the minute averaged", () => {
    const suddenStop = [...minute(46).slice(0, 50), ...minute(0).slice(50)];
    const headline = overviewHeadline(data({ throughput: suddenStop }));
    expect(headline.state).toBe("stalled");
  });

  it("flowing again as soon as submits resume, even after a quiet minute", () => {
    const restart = [...minute(0).slice(0, 55), ...minute(40).slice(55)];
    const headline = overviewHeadline(data({ throughput: restart }));
    expect(headline.state).toBe("flowing");
  });

  it("ramping up: quotes the recent rate beside the minute's mean", () => {
    const rampUp = [...minute(0).slice(0, 48), ...minute(46).slice(48)];
    const headline = overviewHeadline(data({ throughput: rampUp }));
    expect(sentenceText(headline.sentence)).toBe(
      `Traffic is flowing at 46.0 submits/s now, 9.2/s over the last minute. 6,468 messages are queued and the oldest has waited 2.1${NBSP}s.`,
    );
  });

  it("slowing down: quotes the recent rate beside the minute's mean", () => {
    const slowDown = [...minute(46).slice(0, 50), ...minute(4).slice(50)];
    const headline = overviewHeadline(
      data({ queue: { depth: 6_468, oldest_age_ms: 81_400, in_flight: 14 }, throughput: slowDown }),
    );
    expect(sentenceText(headline.sentence)).toContain(
      "Submits run at 4.0/s now, 39.0/s over the last minute.",
    );
  });

  it("at the limit is judged on the last 10 s", () => {
    const reachedLimit = [...minute(40).slice(0, 50), ...minute(50).slice(50)];
    const headline = overviewHeadline(data({ throughput: reachedLimit }));
    expect(sentenceText(headline.sentence)).toContain("at the carrier’s 50/s limit");
  });

  it("names dead webhooks as an attention figure in the lede", () => {
    const headline = overviewHeadline(data({ webhooks: { pending: 0, delivered: 10, dead: 3 } }));
    expect(sentenceText(headline.lede)).toContain("3 webhook deliveries are dead after retries");
    expect(headline.lede).toContainEqual({ kind: "figure", text: "3", attention: true });
  });

  it("draining: queue empty, submits still with the carrier", () => {
    const headline = overviewHeadline(
      data({ queue: { depth: 0, oldest_age_ms: 0, in_flight: 14 }, throughput: minute(12) }),
    );
    expect(headline.state).toBe("draining");
    expect(sentenceText(headline.sentence)).toBe(
      "The queue has drained; 14 submits are still with the carrier. The last minute averaged 12.0 submits/s.",
    );
  });

  it("idle: nothing queued and nothing in flight", () => {
    const headline = overviewHeadline(
      data({ queue: { depth: 0, oldest_age_ms: 0, in_flight: 0 }, throughput: minute(0) }),
    );
    expect(headline.state).toBe("idle");
    expect(sentenceText(headline.sentence)).toBe(
      "Idle. Nothing is queued and nothing is with the carrier.",
    );
  });

  it("keeps the same words when only a figure changes", () => {
    const words = (depth: number) =>
      overviewHeadline(data({ queue: { depth, oldest_age_ms: 2_000, in_flight: 1 } }))
        .sentence.filter((part) => part.kind !== "figure")
        .map((part) => part.text);
    expect(words(6_468)).toEqual(words(6_412));
  });
});
