import type { DepthSample } from "./queue-trend";
import { TREND_MIN_SAMPLES, TREND_SAMPLES } from "./queue-trend";
import styles from "./overview.module.css";

const WIDTH = 64;
const HEIGHT = 14;

/**
 * Queue depth over the last minute in a fixed box, so the dotted leader
 * always stops at the same place. Zero is the hairline at the bottom; the
 * samples run from the left edge, one step a second, and the line is only
 * drawn once there are enough of them to be a trend. Decorative: the change
 * is written beside the label.
 */
export function Sparkline({ samples }: { samples: readonly DepthSample[] }) {
  const step = WIDTH / (TREND_SAMPLES - 1);
  const max = Math.max(1, ...samples.map((sample) => sample.depth));
  const points = samples.map((sample, index) => ({
    x: index * step,
    y: HEIGHT - (sample.depth / max) * HEIGHT,
  }));
  const last = points.at(-1);

  return (
    <svg aria-hidden viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={styles.trend}>
      {last ? <path d={`M0 ${HEIGHT - 0.5}H${WIDTH}`} className={styles.trendBase} /> : null}
      {last && samples.length >= TREND_MIN_SAMPLES ? (
        <>
          <polyline
            points={points.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}
          />
          <circle cx={last.x} cy={last.y} r="1.75" />
        </>
      ) : null}
    </svg>
  );
}
