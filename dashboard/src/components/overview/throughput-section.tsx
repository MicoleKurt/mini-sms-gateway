"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import type { Overview } from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";
import { Figure } from "@/components/ui/figures";
import { Section } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { TimeOfDay } from "@/components/ui/time-of-day";
import { formatRate, formatSetting } from "./overview-format";
import styles from "./overview.module.css";
import { summarizeThroughput, type ThroughputSummary } from "./throughput";
import { ThroughputChart } from "./throughput-chart";

function range(min: number, max: number) {
  return (
    <span className={`num ${styles.range}`}>
      {formatCount(min)}–{formatCount(max)}
    </span>
  );
}

function Figures({ summary, limit }: { summary: ThroughputSummary; limit: number }) {
  const { submitted, finalized } = summary;
  const headroom = limit - submitted.mean;

  return (
    <div className={styles.figures}>
      <div>
        <p className="lbl">Submitted</p>
        <p>
          <Figure value={formatRate(submitted.mean)} unit="/s mean" />
          <span className={styles.lastSample}>
            <span className="num">{formatCount(submitted.last)}</span> last second
          </span>
        </p>
        <p className={styles.figureCaption}>
          range {range(submitted.min, submitted.max)},{" "}
          {summary.secondsAtLimit === 0 ? (
            "never at the limit"
          ) : (
            <>
              at the limit for <span className="num">{summary.secondsAtLimit}</span> s
            </>
          )}
        </p>
      </div>
      <div>
        <p className="lbl">Finalized</p>
        <p>
          <Figure size="mid" value={formatRate(finalized.mean)} unit="/s mean" />
        </p>
        <p className={styles.figureCaption}>
          receipts arriving, range {range(finalized.min, finalized.max)}
        </p>
      </div>
      <div>
        <p className="lbl">Headroom</p>
        <p>
          {headroom > 0 ? (
            <Figure
              size="mid"
              value={formatRate(headroom)}
              unit={`/s below ${formatSetting(limit)}`}
            />
          ) : (
            <Figure size="mid" value="none" unit={`at the ${formatSetting(limit)}/s limit`} />
          )}
        </p>
      </div>
    </div>
  );
}

function Body({ query }: { query: UseQueryResult<Overview> }) {
  if (query.data) {
    const { throughput, carrier } = query.data;
    if (throughput.length === 0) {
      return (
        <EmptyState
          title="No per-second rates yet."
          description="The gateway reports one point a second once its dispatcher has run."
        />
      );
    }
    const summary = summarizeThroughput(throughput, carrier.limit_per_second);
    return (
      <div className={styles.throughput}>
        <Figures summary={summary} limit={carrier.limit_per_second} />
        <ThroughputChart
          points={throughput}
          limit={carrier.limit_per_second}
          target={carrier.target_per_second}
          summary={summary}
        />
      </div>
    );
  }
  if (query.isLoadingError) {
    return (
      <ErrorState
        title="Throughput could not be loaded"
        error={query.error}
        onRetry={() => query.refetch()}
      />
    );
  }
  return (
    <div className={styles.throughput}>
      <LoadingState label="Loading throughput" lines={3} widths={["60%", "80%", "50%"]} />
      <Skeleton className="h-[244px]" />
    </div>
  );
}

function Window({ overview }: { overview: Overview | undefined }) {
  const first = overview?.throughput[0];
  const last = overview?.throughput.at(-1);
  if (!first || !last) return <>Per second, last minute</>;
  return (
    <>
      Per second, <TimeOfDay at={first.t} millis={false} />–<TimeOfDay at={last.t} millis={false} />{" "}
      UTC
    </>
  );
}

/** Submits and receipts per second over the last minute, against the carrier limit. */
export function ThroughputSection({ query }: { query: UseQueryResult<Overview> }) {
  return (
    <Section label="Carrier throughput" context={<Window overview={query.data} />}>
      <Body query={query} />
    </Section>
  );
}
