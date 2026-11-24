"use client";

import { parseAsIsoDateTime, parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import {
  RANGE_IDS,
  hasActiveFilters,
  normalizeFilters,
  type MessageFilters,
} from "@/lib/message-filters";
import { MESSAGE_STATUSES } from "@/lib/status";

const PARSERS = {
  tenant: parseAsString,
  status: parseAsStringLiteral(MESSAGE_STATUSES),
  // Missing means "all", or "custom" when the link has bounds (see normalizeFilters).
  range: parseAsStringLiteral(RANGE_IDS),
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
  const [url, setUrl] = useQueryStates(PARSERS);
  const filters = normalizeFilters(url);

  return {
    filters,
    hasFilters: hasActiveFilters(filters),
    // "All" is the default and is left out of the URL, as before.
    setFilters: (changes: Partial<MessageFilters>) =>
      void setUrl(changes.range === "all" ? { ...changes, range: null } : changes),
    clearFilters: () => void setUrl(null),
  };
}
