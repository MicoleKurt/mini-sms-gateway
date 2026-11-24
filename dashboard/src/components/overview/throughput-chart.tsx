"use client";

import { Activity } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import type { Overview, ThroughputPoint } from "@/lib/api/schemas";
import { formatClock, formatCount, localZoneLabel } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";

const PLOT_HEIGHT = "h-64";
const SUBMITTED_COLOUR = "var(--status-submitted)";
const FINALIZED_COLOUR = "var(--ink)";
const LIMIT_COLOUR = "var(--danger)";
const AXIS_TICK = { fill: "var(--ink-faint)", fontSize: 11 };

function LegendKey({ swatch, label, value }: { swatch: string; label: string; value: string }) {
  return (
    <li className="flex items-center gap-1.5 text-xs text-ink-muted">
      <span aria-hidden className={swatch} />
      {label}
      <span className="font-mono font-medium text-ink">{value}</span>
    </li>
  );
}

function Legend({ latest, limit }: { latest: ThroughputPoint | undefined; limit: number }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1">
      <LegendKey
        swatch="h-2.5 w-3 rounded-xs border-t-2 border-(--status-submitted) bg-(--status-submitted)/15"
        label="Submitted"
        value={`${formatCount(latest?.submitted ?? 0)}/s`}
      />
      <LegendKey
        swatch="w-3 border-t-2 border-ink"
        label="Finalized"
        value={`${formatCount(latest?.finalized ?? 0)}/s`}
      />
      <LegendKey
        swatch="w-3 border-t-2 border-dashed border-danger"
        label="Carrier limit"
        value={`${formatCount(limit)}/s`}
      />
    </ul>
  );
}

function PointTooltip({ active, payload }: TooltipContentProps) {
  const point = payload[0]?.payload as ThroughputPoint | undefined;
  if (!active || !point) return null;
  return (
    <div className="rounded-md border border-line bg-surface px-2.5 py-2 text-xs shadow-md">
      <p className="font-mono text-ink-muted">{formatClock(point.t)}</p>
      <p className="mt-1 flex justify-between gap-4 text-ink-muted">
        Submitted{" "}
        <span className="font-mono font-medium text-ink">{formatCount(point.submitted)}/s</span>
      </p>
      <p className="flex justify-between gap-4 text-ink-muted">
        Finalized{" "}
        <span className="font-mono font-medium text-ink">{formatCount(point.finalized)}/s</span>
      </p>
    </div>
  );
}

function Plot({ points, limit }: { points: ThroughputPoint[]; limit: number }) {
  const latest = points.at(-1);
  const summary =
    `Submits and final states per second for the last ${points.length} seconds. ` +
    `Latest: ${latest?.submitted ?? 0} submitted and ${latest?.finalized ?? 0} finalized per second. ` +
    `The carrier limit is ${limit} per second.`;

  return (
    <div className={`flex flex-col ${PLOT_HEIGHT}`}>
      <figure className="min-h-0 flex-1" role="img" aria-label={summary}>
        <ComposedChart
          responsive
          data={points}
          margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
          style={{ width: "100%", height: "100%" }}
          accessibilityLayer={false}
        >
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis
            dataKey="t"
            tickFormatter={formatClock}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: "var(--line-strong)" }}
            minTickGap={56}
          />
          <YAxis
            allowDecimals={false}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip
            content={PointTooltip}
            cursor={{ stroke: "var(--line-strong)" }}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="submitted"
            stroke={SUBMITTED_COLOUR}
            strokeWidth={2}
            fill={SUBMITTED_COLOUR}
            fillOpacity={0.12}
            dot={false}
            activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
            // The series moves one step every second. Animating each step would never settle.
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="finalized"
            stroke={FINALIZED_COLOUR}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
          <ReferenceLine
            y={limit}
            stroke={LIMIT_COLOUR}
            strokeDasharray="6 4"
            ifOverflow="extendDomain"
          />
        </ComposedChart>
      </figure>
      {/* Rendered with the data, in the browser only: the server does not know the zone. */}
      <p className="text-right text-xs text-ink-faint">Time of day, {localZoneLabel()}</p>
    </div>
  );
}

/**
 * Submits per second (area) and final states per second (line) for the last
 * minute, against the carrier's rate limit. The series comes from GET
 * /internal/overview and is extended by "stats" events (see useOverview).
 */
export function ThroughputChart({ query }: { query: UseQueryResult<Overview> }) {
  return (
    <Card className="flex flex-col">
      <CardHeader
        title="Carrier throughput"
        description="Submits and final states per second, last 60 seconds."
        actions={
          query.data ? (
            <Legend
              latest={query.data.throughput.at(-1)}
              limit={query.data.carrier.limit_per_second}
            />
          ) : null
        }
      />
      <div className="px-4 pt-3 pb-4">
        {query.isPending ? (
          <Skeleton className={PLOT_HEIGHT} />
        ) : query.isLoadingError ? (
          // Only without any data. After a failed refresh the last series stays up.
          <ErrorState
            className={PLOT_HEIGHT}
            title="Throughput could not be loaded"
            error={query.error}
            onRetry={() => query.refetch()}
          />
        ) : query.data.throughput.length === 0 ? (
          <EmptyState
            className={PLOT_HEIGHT}
            icon={<Activity aria-hidden />}
            title="No throughput yet"
            description="The gateway has not reported any per-second rates."
          />
        ) : (
          <Plot points={query.data.throughput} limit={query.data.carrier.limit_per_second} />
        )}
      </div>
    </Card>
  );
}
