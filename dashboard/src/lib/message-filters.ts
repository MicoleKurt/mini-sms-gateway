import type { Message } from "@/lib/api/schemas";
import type { MessageStatus } from "@/lib/status";

export const RANGE_PRESETS = [
  { id: "15m", label: "15 min", milliseconds: 15 * 60_000 },
  { id: "1h", label: "1 h", milliseconds: 60 * 60_000 },
  { id: "24h", label: "24 h", milliseconds: 24 * 60 * 60_000 },
  { id: "7d", label: "7 d", milliseconds: 7 * 24 * 60 * 60_000 },
] as const;

/** "all" has no bounds, a preset is relative to now, "custom" uses `from` and `to`. */
export const RANGE_IDS = ["all", "15m", "1h", "24h", "7d", "custom"] as const;

export type RangeId = (typeof RANGE_IDS)[number];

export interface MessageFilters {
  tenant: string | null;
  status: MessageStatus | null;
  range: RangeId;
  from: Date | null;
  to: Date | null;
  /** Exact match on message ID, destination number or client_ref. */
  q: string | null;
}

export const NO_FILTERS: MessageFilters = {
  tenant: null,
  status: null,
  range: "all",
  from: null,
  to: null,
  q: null,
};

export function hasActiveFilters(filters: MessageFilters): boolean {
  return (
    filters.tenant !== null ||
    filters.status !== null ||
    filters.q !== null ||
    filters.range !== "all"
  );
}

/** A plain, serialisable form of the filters, used as the query key. */
export function filtersKey(filters: MessageFilters) {
  return {
    ...filters,
    from: filters.from?.toISOString() ?? null,
    to: filters.to?.toISOString() ?? null,
  };
}

/**
 * The created_from / created_to bounds for the API. A preset is resolved
 * against `now` at the moment of the request, so "15 min" always means the
 * last 15 minutes and not 15 minutes before the filter was chosen.
 */
export function createdBounds(
  filters: MessageFilters,
  now: number,
): { from: string | null; to: string | null } {
  if (filters.range === "custom") {
    return { from: filters.from?.toISOString() ?? null, to: filters.to?.toISOString() ?? null };
  }
  const preset = RANGE_PRESETS.find(({ id }) => id === filters.range);
  return { from: preset ? new Date(now - preset.milliseconds).toISOString() : null, to: null };
}

function isWithin(bounds: { from: string | null; to: string | null }, iso: string): boolean {
  const time = Date.parse(iso);
  if (bounds.from !== null && time < Date.parse(bounds.from)) return false;
  if (bounds.to !== null && time > Date.parse(bounds.to)) return false;
  return true;
}

/** Would the list endpoint return this message for these filters? */
export function matchesFilters(filters: MessageFilters, message: Message, now: number): boolean {
  if (filters.tenant !== null && message.tenant_id !== filters.tenant) return false;
  if (filters.status !== null && message.status !== filters.status) return false;
  if (
    filters.q !== null &&
    filters.q !== message.id &&
    filters.q !== message.to &&
    filters.q !== message.client_ref
  ) {
    return false;
  }
  return isWithin(createdBounds(filters, now), message.created_at);
}

/**
 * Could messages of a batch that was accepted at `acceptedAt` show up in this
 * list? A batch event carries no message fields, so a search filter can not
 * be checked and is treated as "no".
 */
export function batchCouldMatch(
  filters: MessageFilters,
  batch: { tenant_id: string; occurred_at: string },
  now: number,
): boolean {
  if (filters.tenant !== null && batch.tenant_id !== filters.tenant) return false;
  if (filters.status !== null && filters.status !== "ACCEPTED") return false;
  if (filters.q !== null) return false;
  return isWithin(createdBounds(filters, now), batch.occurred_at);
}
