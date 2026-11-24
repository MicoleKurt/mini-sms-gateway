"use client";

import { format } from "date-fns";
import { X } from "lucide-react";
import type { Tenant } from "@/lib/api/schemas";
import { cn } from "@/lib/cn";
import { RANGE_PRESETS, type MessageFilters, type RangeId } from "@/lib/message-filters";
import { MESSAGE_STATUSES, STATUS_LABEL, type MessageStatus } from "@/lib/status";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { SearchBox } from "./search-box";

interface FilterBarProps {
  filters: MessageFilters;
  hasFilters: boolean;
  /** Undefined while the tenants are loading or if they failed to load. */
  tenants: Tenant[] | undefined;
  onChange: (changes: Partial<MessageFilters>) => void;
  onClear: () => void;
}

const RANGE_OPTIONS: { id: RangeId; label: string }[] = [
  { id: "all", label: "All" },
  ...RANGE_PRESETS,
];

// On a phone the two labels get one width, so the inputs line up under each other.
const BOUND_LABEL = "w-36 shrink-0 text-xs text-ink-muted sm:w-auto";

/** The value format of <input type="datetime-local">, in local time. */
function toLocalInputValue(date: Date | null): string {
  return date ? format(date, "yyyy-MM-dd'T'HH:mm") : "";
}

function fromLocalInputValue(value: string): Date | null {
  const date = new Date(value);
  return value === "" || Number.isNaN(date.getTime()) ? null : date;
}

export function FilterBar({ filters, hasFilters, tenants, onChange, onClear }: FilterBarProps) {
  // Typing a custom bound switches to the custom range. Emptying both goes back to "All".
  function changeBound(bound: "from" | "to", value: string) {
    const next = { from: filters.from, to: filters.to, [bound]: fromLocalInputValue(value) };
    onChange({ ...next, range: next.from || next.to ? "custom" : "all" });
  }

  // A tenant from a shared link stays selectable even before the tenants have loaded.
  const tenantIsListed = tenants?.some((tenant) => tenant.id === filters.tenant) ?? false;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <SearchBox value={filters.q ?? ""} onCommit={(q) => onChange({ q: q === "" ? null : q })} />

      <label htmlFor="filter-tenant" className="sr-only">
        Tenant
      </label>
      <Select
        id="filter-tenant"
        className="min-w-32 flex-1 sm:w-40 sm:flex-none"
        value={filters.tenant ?? ""}
        onChange={(event) => onChange({ tenant: event.target.value || null })}
      >
        <option value="">All tenants</option>
        {filters.tenant !== null && !tenantIsListed ? (
          <option value={filters.tenant}>{filters.tenant}</option>
        ) : null}
        {tenants?.map((tenant) => (
          <option key={tenant.id} value={tenant.id}>
            {tenant.name}
          </option>
        ))}
      </Select>

      <label htmlFor="filter-status" className="sr-only">
        Status
      </label>
      <Select
        id="filter-status"
        className="min-w-32 flex-1 sm:w-36 sm:flex-none"
        value={filters.status ?? ""}
        onChange={(event) =>
          onChange({ status: (event.target.value || null) as MessageStatus | null })
        }
      >
        <option value="">All statuses</option>
        {MESSAGE_STATUSES.map((status) => (
          <option key={status} value={status}>
            {STATUS_LABEL[status]}
          </option>
        ))}
      </Select>

      <div
        role="group"
        aria-label="Created within"
        className="flex h-8 items-center rounded-md border border-control-border bg-surface p-0.5"
      >
        {RANGE_OPTIONS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={filters.range === id}
            onClick={() => onChange({ range: id, from: null, to: null })}
            className={cn(
              "h-full rounded px-2 text-xs font-medium whitespace-nowrap transition-colors",
              filters.range === id
                ? "bg-primary text-on-primary"
                : "text-ink-muted hover:bg-raised hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex w-full items-center gap-2 sm:w-auto">
        <label htmlFor="filter-from" className={BOUND_LABEL}>
          Created from (local time)
        </label>
        <Input
          id="filter-from"
          type="datetime-local"
          className="min-w-0 flex-1 font-mono text-xs sm:w-48 sm:flex-none"
          value={toLocalInputValue(filters.from)}
          max={toLocalInputValue(filters.to) || undefined}
          onChange={(event) => changeBound("from", event.target.value)}
        />
      </div>
      <div className="flex w-full items-center gap-2 sm:w-auto">
        <label htmlFor="filter-to" className={BOUND_LABEL}>
          Created to
        </label>
        <Input
          id="filter-to"
          type="datetime-local"
          className="min-w-0 flex-1 font-mono text-xs sm:w-48 sm:flex-none"
          value={toLocalInputValue(filters.to)}
          min={toLocalInputValue(filters.from) || undefined}
          onChange={(event) => changeBound("to", event.target.value)}
        />
      </div>

      {hasFilters ? (
        <Button variant="ghost" size="md" onClick={onClear}>
          <X aria-hidden />
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
