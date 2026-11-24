"use client";

import type { ThroughputPoint } from "@/lib/api/schemas";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { formatRate, formatSetting } from "./overview-format";
import styles from "./overview.module.css";
import {
  WINDOW_SECONDS,
  linearScale,
  spreadLabels,
  timeTicks,
  placeInWindow,
  type ThroughputSummary,
} from "./throughput";
import { useElementWidth } from "./use-element-width";

const HEIGHT = 244;
/** Room for the y values on the left and the line-end labels on the right. */
const LEFT = 34;
const RIGHT = 136;
/** Below this width the line-end labels move above the plot, which gets the full width. */
const NARROW = 520;
const SUBMITS = { top: 10, bottom: 160 };
const RECEIPTS = { top: 188, bottom: 222 };
const TICK_LABEL_Y = 238;
/** Room from a full time label ("17:47:40") to the next one, with space between. */
const TICK_LABEL_WIDTH = 76;
/** Line-end labels are 12 px and axis values 11 px; this keeps two from touching. */
const LABEL_GAP = 13;
/** A label moved further than this from its line gets a leader back to it. */
const LEADER_AFTER = 2;

interface ChartProps {
  points: readonly ThroughputPoint[];
  limit: number;
  target: number;
  summary: ThroughputSummary;
}

/** One horizontal step per second, joined by verticals; a missing second breaks the line. */
function stepPath(
  points: readonly ThroughputPoint[],
  slotX: (slot: number) => number,
  slotWidth: number,
  y: (value: number) => number,
): string {
  let path = "";
  let previousSlot = Number.NaN;
  for (const { point, slot } of placeInWindow(points)) {
    const left = slotX(slot);
    const py = y(point.submitted).toFixed(1);
    path += slot === previousSlot + 1 ? `V${py}` : `M${left.toFixed(1)} ${py}`;
    path += `H${(left + slotWidth).toFixed(1)}`;
    previousSlot = slot;
  }
  return path;
}

/** A label at the end of a line, moved off its line only as far as it must. */
function LineLabel({
  x,
  lineY,
  labelY,
  className,
  children,
}: {
  x: number;
  lineY: number;
  labelY: number;
  className?: string;
  children: string;
}) {
  return (
    <>
      {Math.abs(labelY - lineY) > LEADER_AFTER ? (
        <path
          d={`M${x - 11} ${lineY.toFixed(1)}L${x - 3} ${labelY.toFixed(1)}`}
          stroke="var(--chart-axis)"
          strokeWidth="1"
          fill="none"
        />
      ) : null}
      <text x={x} y={labelY + 4} className={className}>
        {children}
      </text>
    </>
  );
}

function Plot({ width, points, limit, target, summary }: ChartProps & { width: number }) {
  const narrow = width < NARROW;
  const x0 = LEFT;
  const x1 = Math.max(LEFT + WINDOW_SECONDS, width - (narrow ? 4 : RIGHT));
  const slotWidth = (x1 - x0) / WINDOW_SECONDS;
  const slotX = (slot: number) => x0 + slot * slotWidth;

  // Each series has its own linear scale from zero.
  const y = linearScale(
    [0, Math.max(limit, summary.submitted.max) * 1.08],
    [SUBMITS.bottom, SUBMITS.top],
  );
  const receiptsMax = Math.max(limit, summary.finalized.max);
  const yReceipts = linearScale([0, receiptsMax], [RECEIPTS.bottom, RECEIPTS.top]);

  const showTarget = target > 0 && target < limit;
  const lineEnds = showTarget
    ? [y(limit), y(target), y(summary.submitted.last)]
    : [y(limit), y(summary.submitted.last)];
  const placed = spreadLabels(lineEnds, LABEL_GAP, SUBMITS.top, SUBMITS.bottom);
  const limitLabelY = placed[0] ?? 0;
  const targetLabelY = showTarget ? (placed[1] ?? 0) : 0;
  const nowLabelY = placed.at(-1) ?? 0;
  // The axis names the limit, the target and zero. Values that would touch move apart.
  const [limitTickY = 0, targetTickY = 0] = spreadLabels(
    showTarget ? [y(limit), y(target)] : [y(limit)],
    LABEL_GAP - 1,
    SUBMITS.top,
    SUBMITS.bottom - LABEL_GAP,
  );
  const labelX = x1 + 14;
  const barWidth = Math.max(1, slotWidth - 2.5);

  const summaryText =
    `Submits per second over the last ${summary.seconds} seconds: mean ${formatRate(summary.submitted.mean)}, ` +
    `last second ${formatCount(summary.submitted.last)}, against the carrier limit of ${formatSetting(limit)}` +
    (showTarget ? ` and the target of ${formatSetting(target)}` : "") +
    `. Receipts per second: mean ${formatRate(summary.finalized.mean)}.`;

  return (
    <svg
      width={width}
      height={HEIGHT}
      viewBox={`0 0 ${width} ${HEIGHT}`}
      role="img"
      aria-label={summaryText}
      className={styles.chart}
    >
      {/* Submits: headroom band, zero line, target, limit, then the series. */}
      {showTarget ? (
        <rect
          x={x0}
          y={y(limit)}
          width={x1 - x0}
          height={y(target) - y(limit)}
          fill="var(--chart-headroom)"
        />
      ) : null}
      <path d={`M${x0} ${SUBMITS.bottom + 0.5}H${x1}`} stroke="var(--chart-axis)" strokeWidth="1" />
      {showTarget ? (
        <path
          d={`M${x0} ${Math.round(y(target)) + 0.5}H${x1}`}
          stroke="var(--chart-target)"
          strokeWidth="1"
          strokeDasharray="2 3"
        />
      ) : null}
      <path
        d={`M${x0} ${Math.round(y(limit))}H${x1}`}
        stroke="var(--chart-limit)"
        strokeWidth="2"
      />
      <path
        d={stepPath(points, slotX, slotWidth, y)}
        fill="none"
        stroke="var(--chart-submitted)"
        strokeWidth="1.5"
        strokeLinejoin="miter"
      />

      <text
        x={x0 - 8}
        y={limitTickY + 4}
        textAnchor="end"
        className={cn(styles.axis, styles.axisStrong)}
      >
        {formatSetting(limit)}
      </text>
      {showTarget ? (
        <text x={x0 - 8} y={targetTickY + 4} textAnchor="end" className={styles.axis}>
          {formatSetting(target)}
        </text>
      ) : null}
      <text x={x0 - 8} y={SUBMITS.bottom + 4} textAnchor="end" className={styles.axis}>
        0
      </text>

      {narrow ? null : (
        <>
          <LineLabel x={labelX} lineY={y(limit)} labelY={limitLabelY} className={styles.lineLabel}>
            {`Carrier limit ${formatSetting(limit)}`}
          </LineLabel>
          {showTarget ? (
            <LineLabel
              x={labelX}
              lineY={y(target)}
              labelY={targetLabelY}
              className={cn(styles.lineLabel, styles.lineLabelQuiet)}
            >
              {`Target ${formatSetting(target)}`}
            </LineLabel>
          ) : null}
          <LineLabel
            x={labelX}
            lineY={y(summary.submitted.last)}
            labelY={nowLabelY}
            className={cn(styles.lineLabel, styles.lineLabelSubmitted)}
          >
            {`Submitted ${formatCount(summary.submitted.last)} now`}
          </LineLabel>
        </>
      )}

      {/* Receipts: a strip of bars with its own zero line and scale. */}
      <path d={`M${x0} ${RECEIPTS.top + 0.5}H${x1}`} stroke="var(--chart-grid)" strokeWidth="1" />
      {placeInWindow(points).map(({ point, slot }) =>
        point.finalized > 0 ? (
          <rect
            key={point.t}
            x={slotX(slot) + (slotWidth - barWidth) / 2}
            y={yReceipts(point.finalized)}
            width={barWidth}
            height={RECEIPTS.bottom - yReceipts(point.finalized)}
            fill="var(--chart-receipts)"
          />
        ) : null,
      )}
      <path
        d={`M${x0} ${RECEIPTS.bottom + 0.5}H${x1}`}
        stroke="var(--chart-axis)"
        strokeWidth="1"
      />
      {/* The bars stand on their own zero line, so only the top of their scale is named. */}
      <text x={x0 - 8} y={RECEIPTS.top + 8} textAnchor="end" className={styles.axis}>
        {`${formatSetting(receiptsMax)}/s`}
      </text>
      {narrow ? null : (
        <text
          x={labelX}
          y={(RECEIPTS.top + RECEIPTS.bottom) / 2 + 4}
          className={cn(styles.lineLabel, styles.lineLabelReceipts)}
        >
          Finalized {formatCount(summary.finalized.last)} now
        </text>
      )}

      {timeTicks(points, Math.ceil(TICK_LABEL_WIDTH / slotWidth)).map((tick) => {
        const x = slotX(tick.slot) + slotWidth / 2;
        const anchorX = tick.anchor === "start" ? x0 : tick.anchor === "end" ? x1 : x;
        return (
          <g key={tick.slot}>
            <path d={`M${x.toFixed(1)} ${RECEIPTS.bottom + 1}v4`} stroke="var(--chart-axis)" />
            <text x={anchorX} y={TICK_LABEL_Y} textAnchor={tick.anchor} className={styles.axis}>
              {tick.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Submits per second as a step line against the carrier limit (the
 * strongest line) and the target, with the headroom between them as a flat
 * band; receipts per second as their own strip of bars underneath. Every
 * line is labelled at its end, so there is no legend.
 */
export function ThroughputChart(props: ChartProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const { limit, target, summary } = props;
  return (
    <div className="min-w-0">
      {width > 0 && width < NARROW ? (
        // On a narrow screen the line-end labels are a row above the plot.
        <p aria-hidden className={styles.chartKey}>
          <span>Carrier limit {formatSetting(limit)}</span>
          {target > 0 && target < limit ? (
            <span className={styles.keyTarget}>Target {formatSetting(target)}</span>
          ) : null}
          <span className={styles.keySubmitted}>
            Submitted {formatCount(summary.submitted.last)} now
          </span>
          <span className={styles.keyReceipts}>
            Finalized {formatCount(summary.finalized.last)} now
          </span>
        </p>
      ) : null}
      <div ref={ref} className={styles.chartBox}>
        {width > 0 ? <Plot width={width} {...props} /> : null}
      </div>
    </div>
  );
}
