import type { ThroughputPoint } from "@/lib/api/schemas";

/** The series covers one minute, one point per second. */
export const WINDOW_SECONDS = 60;

export interface SeriesSummary {
  mean: number;
  /** The last one-second sample. */
  last: number;
  min: number;
  max: number;
  total: number;
}

export interface ThroughputSummary {
  /** How many seconds the series has, at most 60. */
  seconds: number;
  submitted: SeriesSummary;
  finalized: SeriesSummary;
  /** Seconds in which submits reached the carrier limit. */
  secondsAtLimit: number;
}

function summarizeSeries(values: readonly number[]): SeriesSummary {
  if (values.length === 0) return { mean: 0, last: 0, min: 0, max: 0, total: 0 };
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    mean: total / values.length,
    last: values.at(-1) ?? 0,
    min: Math.min(...values),
    max: Math.max(...values),
    total,
  };
}

/** Means, ranges and the last sample of both series of the last minute. */
export function summarizeThroughput(
  points: readonly ThroughputPoint[],
  limitPerSecond: number,
): ThroughputSummary {
  const submitted = points.map((point) => point.submitted);
  return {
    seconds: points.length,
    submitted: summarizeSeries(submitted),
    finalized: summarizeSeries(points.map((point) => point.finalized)),
    secondsAtLimit: submitted.filter((value) => value >= limitPerSecond).length,
  };
}

/** Whole seconds since the epoch of an ISO timestamp. */
export function epochSecond(iso: string): number {
  return Math.floor(Date.parse(iso) / 1_000);
}

/** Maps a value in [d0, d1] onto [r0, r1]. */
export function linearScale(
  [d0, d1]: readonly [number, number],
  [r0, r1]: readonly [number, number],
): (value: number) => number {
  const span = d1 - d0 || 1;
  return (value) => r0 + ((value - d0) / span) * (r1 - r0);
}

export interface PlacedPoint {
  point: ThroughputPoint;
  /** 0 for the oldest second of the window, 59 for the last point. */
  slot: number;
}

/**
 * Each point with its slot in the one-minute window, counted back from the
 * last point. A second the gateway did not report leaves its slot empty, and
 * a point older than the window is left out.
 */
export function placeInWindow(points: readonly ThroughputPoint[]): PlacedPoint[] {
  const last = points.at(-1);
  if (!last) return [];
  const lastSecond = epochSecond(last.t);
  return points
    .map((point) => ({ point, slot: WINDOW_SECONDS - 1 - (lastSecond - epochSecond(point.t)) }))
    .filter(({ slot }) => slot >= 0);
}

/**
 * Moves label positions apart so no two are closer than `gap`, keeping their
 * order and staying inside [top, bottom] where there is room. Returns the new
 * positions in the order given.
 */
export function spreadLabels(
  positions: readonly number[],
  gap: number,
  top: number,
  bottom: number,
): number[] {
  const order = positions
    .map((position, index) => ({ position, index }))
    .sort((a, b) => a.position - b.position);

  // Each label at least `gap` below the one above it, and not above `floor`.
  const pushDown = (values: readonly number[], floor: number) => {
    let next = floor;
    return values.map((value) => {
      const placed = Math.max(value, next);
      next = placed + gap;
      return placed;
    });
  };
  // Each label at least `gap` above the one below it, and not below `ceiling`.
  const pushUp = (values: readonly number[], ceiling: number) => {
    let next = ceiling;
    return values
      .toReversed()
      .map((value) => {
        const placed = Math.min(value, next);
        next = placed - gap;
        return placed;
      })
      .toReversed();
  };

  let placed = pushDown(
    order.map((entry) => entry.position),
    -Infinity,
  );
  if ((placed.at(-1) ?? bottom) > bottom) placed = pushUp(placed, bottom);
  if ((placed[0] ?? top) < top) placed = pushDown(placed, top);

  const result = positions.map(() => 0);
  placed.forEach((position, rank) => {
    const entry = order[rank];
    if (entry) result[entry.index] = position;
  });
  return result;
}

export interface TimeTick {
  slot: number;
  label: string;
  anchor: "start" | "middle" | "end";
}

/**
 * Time labels under the chart: the full UTC time at both ends and ":15",
 * ":30", ":45", ":00" in between, leaving out those that would crowd an end.
 * `minSlotGap` is how many one-second slots a short label needs.
 */
export function timeTicks(points: readonly ThroughputPoint[], minSlotGap = 6): TimeTick[] {
  const placed = placeInWindow(points);
  const first = placed[0];
  const last = placed.at(-1);
  if (!first || !last) return [];
  const clock = (iso: string) => new Date(iso).toISOString().slice(11, 19);
  const end: TimeTick = { slot: last.slot, label: `${clock(last.point.t)} UTC`, anchor: "end" };
  // Two full times need room; on a narrow chart only the latest is labelled.
  if (placed.length === 1 || last.slot - first.slot < minSlotGap * 3) return [end];

  const middle = placed.flatMap(({ point, slot }): TimeTick[] => {
    const second = epochSecond(point.t) % 60;
    if (second % 15 !== 0) return [];
    if (slot - first.slot < minSlotGap || last.slot - slot < minSlotGap * 2) return [];
    return [{ slot, label: `:${String(second).padStart(2, "0")}`, anchor: "middle" }];
  });

  return [{ slot: first.slot, label: clock(first.point.t), anchor: "start" }, ...middle, end];
}
