/** One queue depth reading from a "stats" event. */
export interface DepthSample {
  /** Epoch milliseconds of the event. */
  at: number;
  depth: number;
}

/** The trend covers the last minute: one "stats" event a second. */
export const TREND_SAMPLES = 60;

/** Fewer samples than this are not a trend yet: no line, no change. */
export const TREND_MIN_SAMPLES = 10;

/**
 * Adds a sample to the ring of recent ones and drops the oldest beyond
 * `capacity`. A sample for a second already held replaces it, and a sample
 * older than the newest held is ignored, so a reconnect cannot reorder it.
 */
export function pushSample(
  samples: readonly DepthSample[],
  sample: DepthSample,
  capacity = TREND_SAMPLES,
): DepthSample[] {
  const newest = samples.at(-1);
  if (newest && sample.at < newest.at) return [...samples];
  const sameSecond = newest && Math.floor(newest.at / 1_000) === Math.floor(sample.at / 1_000);
  const kept = sameSecond ? samples.slice(0, -1) : samples;
  return [...kept, sample].slice(-capacity);
}

/**
 * How the depth changed across the samples held, and over how many seconds.
 * Null until there are TREND_MIN_SAMPLES of them.
 */
export function depthChange(
  samples: readonly DepthSample[],
): { change: number; seconds: number } | null {
  const first = samples[0];
  const last = samples.at(-1);
  if (!first || !last || samples.length < TREND_MIN_SAMPLES) return null;
  return {
    change: last.depth - first.depth,
    seconds: Math.round((last.at - first.at) / 1_000),
  };
}
