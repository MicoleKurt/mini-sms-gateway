import { describe, expect, it } from "vitest";
import type { Overview, StatsEvent } from "@/lib/api/schemas";
import { recordStats, withLiveOverview } from "./live-overview";

function statsAt(at: string, submitted = 10, finalized = 8): StatsEvent {
  return {
    at,
    tenants: [],
    queue: { depth: 5, oldest_age_ms: 120, in_flight: 2 },
    rate: { submitted_per_second: submitted, finalized_per_second: finalized },
  };
}

const overview: Overview = {
  queue: { depth: 0, oldest_age_ms: 0, in_flight: 0 },
  carrier: { limit_per_second: 50, target_per_second: 47 },
  throughput: [
    { t: "2026-11-24T15:04:04Z", submitted: 1, finalized: 1 },
    { t: "2026-11-24T15:04:05Z", submitted: 2, finalized: 2 },
  ],
  billing: [{ tenant_id: "t1", consistent: true, double_charged: 0 }],
  webhooks: { pending: 3, delivered: 40, dead: 1 },
};

describe("recordStats", () => {
  it("starts from the first event", () => {
    const live = recordStats(null, statsAt("2026-11-24T15:04:06Z"));
    expect(live.queue.depth).toBe(5);
    expect(live.throughput).toEqual([{ t: "2026-11-24T15:04:06Z", submitted: 10, finalized: 8 }]);
  });

  it("appends a point for a new second", () => {
    const first = recordStats(null, statsAt("2026-11-24T15:04:06Z"));
    const second = recordStats(first, statsAt("2026-11-24T15:04:07Z", 20, 18));
    expect(second.throughput.map((point) => point.submitted)).toEqual([10, 20]);
  });

  it("replaces the point when two events report the same second", () => {
    const first = recordStats(null, statsAt("2026-11-24T15:04:06Z"));
    const again = recordStats(first, statsAt("2026-11-24T15:04:06Z", 9, 9));
    expect(again.throughput).toHaveLength(1);
    expect(again.throughput[0]?.submitted).toBe(9);
  });

  it("keeps at most sixty points", () => {
    let live = recordStats(null, statsAt("2026-11-24T15:04:00Z"));
    for (let second = 1; second < 100; second += 1) {
      const at = new Date(Date.parse("2026-11-24T15:04:00Z") + second * 1_000).toISOString();
      live = recordStats(live, statsAt(at));
    }
    expect(live.throughput).toHaveLength(60);
  });
});

describe("withLiveOverview", () => {
  it("is the REST snapshot while the stream has reported nothing", () => {
    expect(withLiveOverview(overview, null)).toBe(overview);
  });

  it("takes the queue from the stream and appends the seconds after the snapshot", () => {
    const live = recordStats(
      recordStats(null, statsAt("2026-11-24T15:04:06Z")),
      statsAt("2026-11-24T15:04:07Z", 20, 18),
    );
    const merged = withLiveOverview(overview, live);
    expect(merged.queue.depth).toBe(5);
    expect(merged.throughput.map((point) => point.submitted)).toEqual([1, 2, 10, 20]);
  });

  it("keeps the snapshot's own points for seconds that both report", () => {
    const live = recordStats(null, statsAt("2026-11-24T15:04:05Z", 99, 99));
    expect(withLiveOverview(overview, live).throughput).toEqual(overview.throughput);
  });

  it("never changes what only REST knows", () => {
    const merged = withLiveOverview(overview, recordStats(null, statsAt("2026-11-24T15:04:06Z")));
    expect(merged.webhooks).toBe(overview.webhooks);
    expect(merged.billing).toBe(overview.billing);
    expect(merged.carrier).toBe(overview.carrier);
  });

  it("shows at most sixty points", () => {
    const full: Overview = {
      ...overview,
      throughput: Array.from({ length: 60 }, (_, second) => ({
        t: new Date(Date.parse("2026-11-24T15:03:00Z") + second * 1_000).toISOString(),
        submitted: second,
        finalized: second,
      })),
    };
    const merged = withLiveOverview(full, recordStats(null, statsAt("2026-11-24T15:04:00Z")));
    expect(merged.throughput).toHaveLength(60);
    expect(merged.throughput.at(-1)?.submitted).toBe(10);
  });
});
