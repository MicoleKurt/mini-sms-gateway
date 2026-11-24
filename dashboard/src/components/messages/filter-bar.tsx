"use client";

import { useId, useState } from "react";
import type { Tenant } from "@/lib/api/schemas";
import { cn } from "@/lib/cn";
import { RANGE_PRESETS, type MessageFilters, type RangeId } from "@/lib/message-filters";
import { MESSAGE_STATUSES, STATUS_LABEL, type MessageStatus } from "@/lib/status";
import { useNow } from "@/lib/use-now";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { PresetGroup, type Preset } from "@/components/ui/preset-group";
import { SearchBox } from "./search-box";
import { UtcBoundInput } from "./utc-bound-input";
import { formatUtcInput } from "./utc-input";

type PresetId = Exclude<RangeId, "custom">;

const RANGE_OPTIONS: readonly Preset<PresetId>[] = [
  { value: "all", label: "All" },
  ...RANGE_PRESETS.map(({ id, label }) => ({ value: id, label })),
];

interface FilterBarProps {
  filters: MessageFilters;
  hasFilters: boolean;
  /** Undefined while the tenants are loading or if they failed to load. */
  tenants: Tenant[] | undefined;
  onChange: (changes: Partial<MessageFilters>) => void;
  onClear: () => void;
}

/** The created-time filter: range presets, then From and To in UTC. */
function CreatedRange({ filters, onChange }: Pick<FilterBarProps, "filters" | "onChange">) {
  const now = useNow(30_000);

  // Typing a bound switches to the custom range. Emptying both goes back to "All".
  function changeBound(bound: "from" | "to", value: Date | null) {
    const next = { from: filters.from, to: filters.to, [bound]: value };
    onChange({ ...next, range: next.from || next.to ? "custom" : "all" });
  }

  // An empty bound shows what it means under the current preset.
  const preset = RANGE_PRESETS.find(({ id }) => id === filters.range);
  const fromPlaceholder = preset ? formatUtcInput(new Date(now - preset.milliseconds)) : "earliest";

  return (
    <div role="group" aria-labelledby="filter-created" className="field max-w-full flex-none">
      <span id="filter-created" className="lbl">
        Created (UTC)
      </span>
      <div className="flex min-h-8 flex-wrap items-center gap-x-4 gap-y-2">
        <PresetGroup
          label="Created within"
          options={RANGE_OPTIONS}
          value={filters.range === "custom" ? null : filters.range}
          onChange={(range) => onChange({ range, from: null, to: null })}
        />
        <span className="flex items-center gap-2">
          <UtcBoundInput
            id="filter-from"
            label="Created from, UTC"
            value={filters.from}
            placeholder={fromPlaceholder}
            onCommit={(value) => changeBound("from", value)}
          />
          <span aria-hidden className="text-ink-3">
            –
          </span>
          <UtcBoundInput
            id="filter-to"
            label="Created to, UTC"
            value={filters.to}
            placeholder="now"
            onCommit={(value) => changeBound("to", value)}
          />
        </span>
      </div>
    </div>
  );
}

/** How many filters besides the search are set, for the "Filters (2)" button on a phone. */
function moreFiltersSet(filters: MessageFilters): number {
  return [filters.tenant !== null, filters.status !== null, filters.range !== "all"].filter(Boolean)
    .length;
}

export function FilterBar({ filters, hasFilters, tenants, onChange, onClear }: FilterBarProps) {
  const moreId = useId();
  // On a phone the filters other than search fold away, so the rows start higher.
  const [moreOpen, setMoreOpen] = useState(false);
  const tenantIsListed = tenants?.some((tenant) => tenant.id === filters.tenant) ?? false;
  const set = moreFiltersSet(filters);

  return (
    <div
      role="search"
      aria-label="Filter messages"
      className="flex flex-wrap items-end gap-x-6 gap-y-5"
    >
      <SearchBox
        className="min-w-48 flex-[1.6_1_13rem]"
        value={filters.q ?? ""}
        onCommit={(q) => onChange({ q: q === "" ? null : q })}
      />

      <button
        type="button"
        aria-expanded={moreOpen}
        aria-controls={moreId}
        onClick={() => setMoreOpen(!moreOpen)}
        className="btn btn-secondary btn-sm show-narrow"
      >
        Filters{set > 0 ? <span className="num"> ({set})</span> : null}
      </button>

      <div id={moreId} className={cn("filter-more", moreOpen && "is-open")}>
        <div className="field min-w-32 flex-[1_1_8rem]">
          <label htmlFor="filter-tenant" className="lbl">
            Tenant
          </label>
          <Select
            id="filter-tenant"
            value={filters.tenant ?? ""}
            onChange={(event) => onChange({ tenant: event.target.value || null })}
          >
            <option value="">All tenants</option>
            {/* A tenant from a link: its ID until the list has loaded, then whether it exists. */}
            {filters.tenant !== null && !tenantIsListed ? (
              <option value={filters.tenant}>{tenants ? "No such tenant" : filters.tenant}</option>
            ) : null}
            {tenants?.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="field min-w-32 flex-[1_1_8rem]">
          <label htmlFor="filter-status" className="lbl">
            Status
          </label>
          <Select
            id="filter-status"
            value={filters.status ?? ""}
            onChange={(event) =>
              onChange({ status: (event.target.value || null) as MessageStatus | null })
            }
          >
            <option value="">Any status</option>
            {MESSAGE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status]}
              </option>
            ))}
          </Select>
        </div>

        <CreatedRange filters={filters} onChange={onChange} />

        {/* Keeps its place when hidden, so the fields do not move as filters come and go.
          On a phone it would take a line of its own, so there it goes. */}
        <Button
          variant="quiet"
          onClick={onClear}
          className={hasFilters ? "mb-0.5" : "invisible mb-0.5 max-md:hidden"}
        >
          Clear all<span className="sr-only"> filters</span>
        </Button>
      </div>
    </div>
  );
}
