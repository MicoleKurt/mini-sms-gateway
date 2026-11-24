import { describe, expect, it } from "vitest";
import { deliveredOnRetry, withChanges } from "./fixtures";
import { phaseLabel, phaseNote, secondsTicks, timeSplit } from "./time-split";

const NOW = Date.parse("2026-11-24T15:58:10.070100Z");

describe("timeSplit", () => {
  it("splits a delivered message into gateway, carrier and tenant time", () => {
    const { spans, totalMs } = timeSplit(deliveredOnRetry, NOW);
    expect(spans.map(({ phase, startMs, endMs, open }) => [phase, startMs, endMs, open])).toEqual([
      ["gateway", 0, 780.678, false],
      ["carrier", 780.678, 9174.32, false],
      ["tenant", 9174.32, 9222.009, false],
    ]);
    expect(totalMs).toBe(9222.009);
  });

  it("runs the current span to now", () => {
    const submitted = withChanges({ status: "SUBMITTED", finalized_at: null }, { webhooks: [] });
    const { spans, totalMs } = timeSplit(submitted, NOW);
    expect(spans.map(({ phase, open }) => [phase, open])).toEqual([
      ["gateway", false],
      ["carrier", true],
    ]);
    // now has millisecond precision; accept was 0.1 ms past the millisecond.
    expect(totalMs).toBeCloseTo(16_999.9, 6);
  });

  it("puts a message that never reached the carrier all in the gateway", () => {
    const failed = withChanges({ status: "FAILED", submitted_at: null }, { webhooks: [] });
    expect(timeSplit(failed, NOW).spans).toEqual([
      { phase: "gateway", startMs: 0, endMs: 9174.32, open: false },
    ]);
  });

  it("leaves out a webhook that died, since it has no end", () => {
    const dead = { ...deliveredOnRetry.webhooks[0]!, status: "DEAD" as const, delivered_at: null };
    const { spans } = timeSplit(withChanges({}, { webhooks: [dead] }), NOW);
    expect(spans.map(({ phase }) => phase)).toEqual(["gateway", "carrier"]);
  });
});

describe("phaseNote and phaseLabel", () => {
  it("say what happened in each span", () => {
    const { spans } = timeSplit(deliveredOnRetry, NOW);
    expect(
      spans.map(
        (span) =>
          `${phaseLabel(span.phase, deliveredOnRetry)}: ${phaseNote(span, deliveredOnRetry)}`,
      ),
    ).toEqual([
      "in the gateway: accept, charge, 1 refused submit, retry",
      "with the carrier: submitted, until the DELIVRD receipt",
      "receipt to tenant: status applied, webhook answered",
    ]);
  });

  it("say what is still running", () => {
    const queued = withChanges(
      { status: "QUEUED", submitted_at: null, finalized_at: null },
      { attempts: [], dlrs: [], webhooks: [] },
    );
    const [gateway] = timeSplit(queued, NOW).spans;
    expect(phaseNote(gateway!, queued)).toBe("accept, charge, waiting for a submit slot");
  });

  it("tell an unanswered submit from a refused one, and name a rejection", () => {
    const timedOut = { ...deliveredOnRetry.attempts[0]!, outcome: "TIMEOUT" as const };
    const ambiguous = withChanges({}, { attempts: [timedOut, deliveredOnRetry.attempts[1]!] });
    const [gateway] = timeSplit(ambiguous, NOW).spans;
    expect(phaseNote(gateway!, ambiguous)).toBe("accept, charge, 1 unanswered submit, retry");

    const rejected = { ...timedOut, outcome: "REJECTED" as const };
    const failed = withChanges(
      { status: "FAILED", submitted_at: null },
      { attempts: [rejected], dlrs: [] },
    );
    const [failedGateway] = timeSplit(failed, NOW).spans;
    expect(phaseNote(failedGateway!, failed)).toBe(
      "accept, charge, the carrier rejected the submit",
    );
  });
});

describe("secondsTicks", () => {
  it("steps by whole seconds for a few seconds, with the unit on the last label", () => {
    const ticks = secondsTicks(9_222);
    expect(ticks.map(({ label }) => label)).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9 s",
    ]);
  });

  it("steps by a fraction for a short span and by a round number for a long one", () => {
    expect(secondsTicks(780).map(({ label }) => label)).toEqual([
      "0.0",
      "0.1",
      "0.2",
      "0.3",
      "0.4",
      "0.5",
      "0.6",
      "0.7 s",
    ]);
    expect(secondsTicks(145_000).map(({ ms }) => ms)).toEqual([
      0, 20_000, 40_000, 60_000, 80_000, 100_000, 120_000, 140_000,
    ]);
  });
});
