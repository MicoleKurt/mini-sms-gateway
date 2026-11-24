"use client";

import { CircleCheck, TriangleExclamationPoint } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Overview, Tenant } from "@/lib/api/schemas";
import { cn } from "@/lib/cn";
import { formatCount, formatDuration } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { LoadingLabel, Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";

const GRID = "grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5";
const TILE_LABELS = ["Queue depth", "Oldest queued", "In flight", "Webhooks pending", "Billing"];

interface TileProps {
  label: string;
  /** "danger" turns the whole tile into an alert. */
  tone?: "neutral" | "danger";
  children: ReactNode;
  className?: string;
}

function Tile({ label, tone = "neutral", children, className }: TileProps) {
  return (
    <section
      className={cn(
        "flex min-h-[5.5rem] flex-col justify-between gap-1 rounded-lg border p-4",
        tone === "danger" ? "border-danger/50 bg-danger-tint" : "border-line bg-surface",
        className,
      )}
    >
      <h3 className="text-xs font-medium text-ink-muted">{label}</h3>
      {children}
    </section>
  );
}

function Value({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-xl leading-7 font-semibold tracking-tight text-ink">{children}</p>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs text-ink-muted">{children}</p>;
}

function BillingTile({ overview, tenants }: { overview: Overview; tenants: Tenant[] | undefined }) {
  const nameOf = (tenantId: string) =>
    tenants?.find((tenant) => tenant.id === tenantId)?.name ?? tenantId;
  const problems = overview.billing.flatMap((entry) => {
    const found = [];
    if (!entry.consistent)
      found.push(`${nameOf(entry.tenant_id)}: balance does not match the ledger`);
    if (entry.double_charged > 0) {
      found.push(`${nameOf(entry.tenant_id)}: ${formatCount(entry.double_charged)} charged twice`);
    }
    return found;
  });

  if (problems.length > 0) {
    return (
      <Tile label="Billing" tone="danger" className="col-span-2 md:col-span-1">
        <div role="alert" className="text-danger-ink">
          <p className="flex items-center gap-1.5 font-semibold">
            <TriangleExclamationPoint aria-hidden className="size-4" />
            Ledger inconsistent
          </p>
          <ul className="mt-1 text-xs">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      </Tile>
    );
  }

  return (
    <Tile label="Billing" className="col-span-2 md:col-span-1">
      <p className="flex items-center gap-1.5 font-semibold text-ok-ink">
        <CircleCheck aria-hidden className="size-4" />
        Ledger consistent
      </p>
      <Note>
        {overview.billing.length === 1 ? "1 tenant" : `${overview.billing.length} tenants`} checked,
        no double charges
      </Note>
    </Tile>
  );
}

interface StatTilesProps {
  overview: UseQueryResult<Overview>;
  /** Only used to show tenant names in a billing alert. */
  tenants: Tenant[] | undefined;
}

function Tiles({ overview, tenants }: StatTilesProps) {
  if (overview.isPending) {
    return (
      <div className={GRID}>
        <LoadingLabel>Loading queue, webhook and billing figures…</LoadingLabel>
        {TILE_LABELS.map((label) => (
          <Tile key={label} label={label} className="last:col-span-2 md:last:col-span-1">
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-4 w-28" />
          </Tile>
        ))}
      </div>
    );
  }

  // Only without any data. After a failed refresh the last figures stay up.
  if (overview.isLoadingError) {
    return (
      // As tall as a row of tiles, so the regions below do not jump.
      <Card className="flex min-h-[5.5rem] items-center">
        <ErrorState
          inline
          className="w-full"
          title="Queue and billing figures could not be loaded"
          error={overview.error}
          onRetry={() => overview.refetch()}
        />
      </Card>
    );
  }

  const { queue, webhooks } = overview.data;

  return (
    <div className={GRID}>
      <Tile label="Queue depth">
        <Value>{formatCount(queue.depth)}</Value>
        <Note>messages waiting for dispatch</Note>
      </Tile>
      <Tile label="Oldest queued">
        <Value>{queue.depth === 0 ? "None" : formatDuration(queue.oldest_age_ms)}</Value>
        <Note>age of the longest waiting message</Note>
      </Tile>
      <Tile label="In flight">
        <Value>{formatCount(queue.in_flight)}</Value>
        <Note>submits waiting for the carrier</Note>
      </Tile>
      <Tile label="Webhooks pending">
        <Value>{formatCount(webhooks.pending)}</Value>
        <Note>
          <span className="font-mono">{formatCount(webhooks.delivered)}</span> delivered,{" "}
          <span className={cn("font-mono", webhooks.dead > 0 && "font-semibold text-danger-ink")}>
            {formatCount(webhooks.dead)}
          </span>{" "}
          <span className={cn(webhooks.dead > 0 && "font-semibold text-danger-ink")}>dead</span>
        </Note>
      </Tile>
      <BillingTile overview={overview.data} tenants={tenants} />
    </div>
  );
}

/** Queue, webhook and billing figures. Queue numbers follow the stream, the rest refresh slowly. */
export function StatTiles(props: StatTilesProps) {
  return (
    // The heading puts the tiles under their own entry in the page outline.
    <section aria-labelledby="figures-heading">
      <h2 id="figures-heading" className="sr-only">
        Queue, webhooks and billing
      </h2>
      <Tiles {...props} />
    </section>
  );
}
