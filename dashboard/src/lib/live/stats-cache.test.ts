import { describe, expect, it } from "vitest";
import type { StatsEvent, Tenant } from "@/lib/api/schemas";
import { emptyCounts } from "@/lib/status";
import { backoffDelay } from "./connection";
import { applyStatsToTenants } from "./stats-cache";

function statsAt(at: string): StatsEvent {
  return {
    at,
    tenants: [
      {
        id: "t1",
        balance_micros: 90,
        counts: { ...emptyCounts(), DELIVERED: 3 },
        total_messages: 3,
      },
    ],
    queue: { depth: 5, oldest_age_ms: 120, in_flight: 2 },
    rate: { submitted_per_second: 10, finalized_per_second: 8 },
  };
}

describe("applyStatsToTenants", () => {
  const tenant: Tenant = {
    id: "t1",
    slug: "acme",
    name: "Acme",
    currency: "USD",
    balance_micros: 100,
    opening_balance_micros: 100,
    callback_url: null,
    api_key_prefix: "sk_",
    counts: emptyCounts(),
    total_messages: 0,
  };

  it("updates the live fields and keeps the rest", () => {
    const [updated] = applyStatsToTenants([tenant], statsAt("2026-11-24T15:04:06Z")) ?? [];
    expect(updated).toMatchObject({ name: "Acme", balance_micros: 90, total_messages: 3 });
    expect(updated?.counts.DELIVERED).toBe(3);
  });

  it("leaves tenants alone that the event does not mention", () => {
    const other = { ...tenant, id: "t2" };
    expect(applyStatsToTenants([other], statsAt("2026-11-24T15:04:06Z"))).toEqual([other]);
  });

  it("does nothing before the tenants are loaded", () => {
    expect(applyStatsToTenants(undefined, statsAt("2026-11-24T15:04:06Z"))).toBeUndefined();
  });
});

describe("backoffDelay", () => {
  it("doubles from one second and stops at fifteen", () => {
    const full = () => 1;
    expect([0, 1, 2, 3, 4, 10].map((failures) => backoffDelay(failures, full))).toEqual([
      1_000, 2_000, 4_000, 8_000, 15_000, 15_000,
    ]);
  });

  it("never waits less than half of the step", () => {
    expect(backoffDelay(2, () => 0)).toBe(2_000);
  });
});
