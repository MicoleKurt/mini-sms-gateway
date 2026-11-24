"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import type { Tenant } from "@/lib/api/schemas";
import { MESSAGE_STATUSES, sumCounts, type MessageStatus, type StatusCounts } from "@/lib/status";
import { Count } from "@/components/ui/figures";
import { Section } from "@/components/ui/section";
import { LoadingState, ErrorState } from "@/components/ui/states";
import { StatusWord } from "@/components/ui/status";
import { formatShare } from "./overview-format";
import styles from "./overview.module.css";
import { StatusStrip } from "./status-strip";

const IN_PROGRESS: readonly MessageStatus[] = ["ACCEPTED", "QUEUED", "SUBMITTED"];

const WHAT_IT_MEANS: Record<MessageStatus, string> = {
  ACCEPTED: "validated, charged",
  QUEUED: "waiting to submit",
  SUBMITTED: "with the carrier",
  DELIVERED: "reached the handset",
  UNDELIVERED: "not delivered, charged",
  EXPIRED: "validity ran out, charged",
  FAILED: "refused at submit, refunded",
};

function StatusLabel({
  status,
  counts,
  total,
}: {
  status: MessageStatus;
  counts: StatusCounts;
  total: number;
}) {
  const final = !IN_PROGRESS.includes(status);
  return (
    <li className={styles.label}>
      <div className={styles.labelHead}>
        <StatusWord status={status} muted={counts[status] === 0} />
        <Count value={counts[status]} className={styles.labelCount} />
      </div>
      <p className={styles.labelNote}>
        {final ? (
          <>
            <span className={`num ${styles.share}`}>{formatShare(counts[status], total)}%</span>
            {" · "}
          </>
        ) : null}
        {WHAT_IT_MEANS[status]}
      </p>
    </li>
  );
}

function PipelineBody({ counts }: { counts: StatusCounts }) {
  const total = MESSAGE_STATUSES.reduce((sum, status) => sum + counts[status], 0);
  const inProgress = IN_PROGRESS.reduce((sum, status) => sum + counts[status], 0);

  return (
    <>
      <p className={styles.stripHead}>
        <span>
          <strong>
            <Count value={total} dimZero={false} />
          </strong>{" "}
          records, <Count value={inProgress} /> still in progress
        </span>
        <span>
          Failed branches off before the carrier and is refunded; undelivered and expired are
          charged.
        </span>
      </p>
      <StatusStrip counts={counts} className={styles.pipelineStrip} />
      <ol className={styles.labels} aria-label="Records by status, in pipeline order">
        {MESSAGE_STATUSES.map((status) => (
          <StatusLabel key={status} status={status} counts={counts} total={total} />
        ))}
      </ol>
    </>
  );
}

/**
 * Every message record by status, all tenants, as one proportional strip in
 * the status inks with a fixed row of labels under it. The counts are kept
 * current by "stats" events in the tenants query.
 */
export function Pipeline({ query }: { query: UseQueryResult<Tenant[]> }) {
  return (
    <Section label="Pipeline" context="Message records since the opening balance, all tenants">
      {query.data ? (
        <PipelineBody counts={sumCounts(query.data.map((tenant) => tenant.counts))} />
      ) : query.isLoadingError ? (
        <ErrorState
          title="Pipeline totals could not be loaded"
          error={query.error}
          onRetry={() => query.refetch()}
        />
      ) : (
        <LoadingState label="Loading pipeline totals" lines={2} widths={["100%", "64%"]} />
      )}
    </Section>
  );
}
