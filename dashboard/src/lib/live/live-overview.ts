import type { Overview, Queue, StatsEvent, ThroughputPoint } from "@/lib/api/schemas";

const THROUGHPUT_WINDOW = 60;

/** The part of the overview that "stats" events carry. */
export interface LiveOverview {
  queue: Queue;
  /** One point per second, oldest first, for at most the last minute. */
  throughput: ThroughputPoint[];
}

function secondOf(iso: string): number {
  return Math.floor(Date.parse(iso) / 1_000);
}

/** Add one "stats" event to what the stream has reported so far. */
export function recordStats(live: LiveOverview | null, stats: StatsEvent): LiveOverview {
  const second = secondOf(stats.at);
  // Two events can report the same second. The later one replaces the point.
  const earlier = live ? live.throughput.filter((point) => secondOf(point.t) < second) : [];
  const point = {
    t: stats.at,
    submitted: stats.rate.submitted_per_second,
    finalized: stats.rate.finalized_per_second,
  };
  return { queue: stats.queue, throughput: [...earlier, point].slice(-THROUGHPUT_WINDOW) };
}

/**
 * The overview to show: the REST snapshot, with the queue numbers of the
 * stream and the seconds the stream has reported after the snapshot's last
 * one. Webhooks, billing and the carrier limit only ever come from REST.
 */
export function withLiveOverview(overview: Overview, live: LiveOverview | null): Overview {
  if (!live) return overview;
  const last = overview.throughput.at(-1);
  const lastSecond = last ? secondOf(last.t) : -Infinity;
  const newer = live.throughput.filter((point) => secondOf(point.t) > lastSecond);
  return {
    ...overview,
    queue: live.queue,
    throughput: [...overview.throughput, ...newer].slice(-THROUGHPUT_WINDOW),
  };
}
