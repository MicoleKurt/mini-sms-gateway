"use client";

import { ArrowRight, CornerDownRight } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { Tenant } from "@/lib/api/schemas";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import {
  STATUS_DESCRIPTION,
  STATUS_LABEL,
  sumCounts,
  type MessageStatus,
  type StatusCounts,
} from "@/lib/status";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";

interface StageProps {
  status: MessageStatus;
  /** Undefined while the totals are loading. */
  counts: StatusCounts | undefined;
  /** Where the stage sits in the wide layout. */
  className?: string;
}

function Stage({ status, counts, className }: StageProps) {
  return (
    <div
      data-status={status}
      className={cn("min-w-0 rounded-md border border-line bg-surface px-3 py-2.5", className)}
    >
      <p className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-status" />
        {STATUS_LABEL[status]}
      </p>
      {/* A long number wraps instead of leaving the box or being cut. */}
      <div className="mt-1 font-mono text-lg leading-6 font-semibold wrap-anywhere text-ink">
        {counts ? formatCount(counts[status]) : <Skeleton className="h-6 w-14" />}
      </div>
      <p className="mt-0.5 text-xs text-ink-faint">{STATUS_DESCRIPTION[status]}</p>
    </div>
  );
}

/** Only in the wide layout. It fills its grid cell, so the icon sits at mid-height of the first row. */
function Arrow({ className }: { className: string }) {
  return (
    <span aria-hidden className={cn("hidden items-center text-ink-faint @4xl:flex", className)}>
      <ArrowRight className="size-4" />
    </span>
  );
}

/**
 * The message state machine with live totals across all tenants. It is also
 * the legend for the status colours, so no label or description is cut.
 *
 * Wide: the flow on one line, ACCEPTED -> QUEUED -> SUBMITTED -> DELIVERED |
 * UNDELIVERED | EXPIRED, with FAILED branching off below QUEUED. Narrow: the
 * same stages in pipeline order, two per row, without the arrows.
 */
export function PipelineStrip({ query }: { query: UseQueryResult<Tenant[]> }) {
  const counts = query.data ? sumCounts(query.data.map((tenant) => tenant.counts)) : undefined;

  return (
    <Card className="@container">
      <CardHeader title="Pipeline" description="Messages in each state, across all tenants." />
      {/* Only without any data. After a failed refresh the last totals stay up. */}
      {query.isLoadingError ? (
        <ErrorState
          className="min-h-[11.75rem]"
          title="Pipeline totals could not be loaded"
          error={query.error}
          onRetry={() => query.refetch()}
        />
      ) : (
        <div
          role="group"
          aria-label="Message pipeline"
          aria-busy={query.isPending}
          className="grid grid-cols-2 gap-2 px-4 pt-3 pb-4 @4xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_repeat(3,minmax(0,1fr))]"
        >
          <Stage status="ACCEPTED" counts={counts} className="@4xl:col-start-1 @4xl:row-start-1" />
          <Arrow className="@4xl:col-start-2 @4xl:row-start-1" />
          <Stage status="QUEUED" counts={counts} className="@4xl:col-start-3 @4xl:row-start-1" />
          <div className="flex min-w-0 gap-1.5 @4xl:col-start-3 @4xl:row-start-2">
            <CornerDownRight
              aria-hidden
              className="hidden size-4 shrink-0 self-center text-ink-faint @4xl:block"
            />
            <Stage status="FAILED" counts={counts} className="flex-1" />
          </div>
          <Arrow className="@4xl:col-start-4 @4xl:row-start-1" />
          <Stage status="SUBMITTED" counts={counts} className="@4xl:col-start-5 @4xl:row-start-1" />
          <Arrow className="@4xl:col-start-6 @4xl:row-start-1" />
          <Stage status="DELIVERED" counts={counts} className="@4xl:col-start-7 @4xl:row-start-1" />
          <Stage
            status="UNDELIVERED"
            counts={counts}
            className="@4xl:col-start-8 @4xl:row-start-1"
          />
          <Stage status="EXPIRED" counts={counts} className="@4xl:col-start-9 @4xl:row-start-1" />
        </div>
      )}
    </Card>
  );
}
