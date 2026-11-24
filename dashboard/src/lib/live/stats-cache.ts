import type { StatsEvent, Tenant } from "@/lib/api/schemas";

/** Copy the live balance and counts of a "stats" event onto the cached tenants. */
export function applyStatsToTenants(
  tenants: Tenant[] | undefined,
  stats: StatsEvent,
): Tenant[] | undefined {
  if (!tenants) return tenants;
  const live = new Map(stats.tenants.map((tenant) => [tenant.id, tenant]));
  return tenants.map((tenant) => {
    const update = live.get(tenant.id);
    if (!update) return tenant;
    return {
      ...tenant,
      balance_micros: update.balance_micros,
      counts: update.counts,
      total_messages: update.total_messages,
    };
  });
}
