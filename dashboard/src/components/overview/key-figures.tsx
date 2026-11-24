"use client";

import type { Overview } from "@/lib/api/schemas";
import { Count, FigureText } from "@/components/ui/figures";
import { Fact, FactsList } from "@/components/ui/facts-list";
import { LiveValue } from "@/components/ui/live-value";
import { Skeleton } from "@/components/ui/skeleton";
import { BACKING_UP_AFTER_MS } from "./headline";
import { formatChange, formatWait } from "./overview-format";
import styles from "./overview.module.css";
import { depthChange, type DepthSample } from "./queue-trend";
import { Sparkline } from "./sparkline";

const LABELS = [
  "Queue depth",
  "Oldest queued",
  "In flight at carrier",
  "Webhooks pending",
  "Webhooks dead",
  "Webhooks delivered",
  "Ledger",
  "Double charges",
];

/**
 * A figure that flashes when it changes. Counts get thousands separators and
 * a zero recedes; a span of time keeps its unit in the words' face.
 */
function Live({ value }: { value: number | string }) {
  return (
    <LiveValue value={value}>
      {typeof value === "number" ? <Count value={value} /> : <FigureText text={value} />}
    </LiveValue>
  );
}

/**
 * "−1,310 in 60 s · live": the trend once there is one, and where the number
 * comes from (the stream, unlike the record counts, which are since the
 * opening balance).
 */
function QueueNote({
  samples,
  streamIsLive,
}: {
  samples: readonly DepthSample[];
  streamIsLive: boolean;
}) {
  const trend = depthChange(samples);
  const source = streamIsLive ? "live" : "polled";
  if (!trend) return <>{source}</>;
  return (
    <>
      <FigureText text={`${formatChange(trend.change)} in ${trend.seconds} s`} /> · {source}
    </>
  );
}

function DeadWebhooksAction({ dead }: { dead: number }) {
  return (
    <p className={styles.action}>
      <b className={`num attn ${styles.actionCount}`}>{dead.toLocaleString("en-US")}</b>
      {dead === 1 ? "webhook delivery" : "webhook deliveries"} dead after retries. The tenants never
      received {dead === 1 ? "that status callback" : "those status callbacks"}; check their
      callback URLs.
    </p>
  );
}

/**
 * The figures behind the headline as a statement: label, leader, value. Only
 * a value past its threshold takes the attention ink, never its label.
 */
export function KeyFigures({
  overview,
  samples,
  streamIsLive,
}: {
  overview: Overview | undefined;
  samples: readonly DepthSample[];
  streamIsLive: boolean;
}) {
  if (!overview) {
    return (
      <FactsList label="Key figures" className={styles.facts}>
        {LABELS.map((label) => (
          <Fact key={label} label={label}>
            <Skeleton className="h-3 w-12" />
          </Fact>
        ))}
      </FactsList>
    );
  }

  const { queue, webhooks, billing } = overview;
  const mismatched = billing.filter((entry) => !entry.consistent).length;
  const doubles = billing.reduce((sum, entry) => sum + entry.double_charged, 0);
  const tenants = billing.length;

  return (
    <div className={styles.facts}>
      <FactsList label="Key figures">
        <Fact
          label="Queue depth"
          note={<QueueNote samples={samples} streamIsLive={streamIsLive} />}
        >
          <Sparkline samples={samples} />
          <Live value={queue.depth} />
        </Fact>
        <Fact
          label="Oldest queued"
          words={queue.depth === 0}
          attention={queue.depth > 0 && queue.oldest_age_ms > BACKING_UP_AFTER_MS}
        >
          {queue.depth === 0 ? (
            <span className="zero">none queued</span>
          ) : (
            <Live value={formatWait(queue.oldest_age_ms)} />
          )}
        </Fact>
        <Fact label="In flight at carrier">
          <Live value={queue.in_flight} />
        </Fact>
        <Fact label="Webhooks pending">
          <Live value={webhooks.pending} />
        </Fact>
        <Fact label="Webhooks dead" attention={webhooks.dead > 0}>
          <Live value={webhooks.dead} />
        </Fact>
        <Fact label="Webhooks delivered">
          <Live value={webhooks.delivered} />
        </Fact>
        <Fact
          label={`Ledger, ${tenants} ${tenants === 1 ? "tenant" : "tenants"}`}
          words
          attention={mismatched > 0}
        >
          {mismatched > 0 ? `${mismatched} out of balance` : "Balanced"}
        </Fact>
        <Fact label="Double charges" attention={doubles > 0}>
          <Live value={doubles} />
        </Fact>
      </FactsList>
      {webhooks.dead > 0 ? <DeadWebhooksAction dead={webhooks.dead} /> : null}
    </div>
  );
}
