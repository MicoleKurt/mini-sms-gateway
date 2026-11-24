"use client";

import { parseAsIsoDateTime, parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { RANGE_IDS, hasActiveFilters, type MessageFilters } from "@/lib/message-filters";
import { MESSAGE_STATUSES } from "@/lib/status";

const PARSERS = {
  tenant: parseAsString,
  status: parseAsStringLiteral(MESSAGE_STATUSES),
  range: parseAsStringLiteral(RANGE_IDS).withDefault("all"),
  // Stored as UTC instants, so a shared link means the same moment in any time zone.
  from: parseAsIsoDateTime,
  to: parseAsIsoDateTime,
  q: parseAsString,
};

/**
 * The message list filters. The URL is the only place they are stored, so a
 * filtered view can be shared and survives a reload.
 */
export function useMessageFilters() {
  const [filters, setFilters] = useQueryStates(PARSERS);

  return {
    filters: filters satisfies MessageFilters,
    hasFilters: hasActiveFilters(filters),
    setFilters: (changes: Partial<MessageFilters>) => void setFilters(changes),
    clearFilters: () => void setFilters(null),
  };
}
