"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import { useOverview, useTenants } from "@/lib/api/hooks";
import type { Overview, Tenant } from "@/lib/api/schemas";
import { useConnectionState } from "@/lib/live/live-provider";
import { Section } from "@/components/ui/section";
import { RefreshFailedNotice } from "@/components/ui/states";
import { TimeOfDay } from "@/components/ui/time-of-day";
import { overviewHeadline, type HeadlineInput } from "./headline";
import { KeyFigures } from "./key-figures";
import { OverviewHeadline } from "./overview-headline";
import styles from "./overview.module.css";
import { Pipeline } from "./pipeline";
import { RecentFailures } from "./recent-failures-table";
import { TenantsTable } from "./tenants-table";
import { ThroughputSection } from "./throughput-section";
import { useQueueTrend } from "./use-queue-trend";

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** When the figures on screen are from: the newest second the gateway reported. */
function lastSeenAt(query: UseQueryResult<Overview>): string | null {
  if (!query.data) return null;
  return query.data.throughput.at(-1)?.t ?? new Date(query.dataUpdatedAt).toISOString();
}

function headlineInput(
  overview: UseQueryResult<Overview>,
  tenants: Tenant[] | undefined,
  streamIsLive: boolean,
): HeadlineInput {
  // With the stream live the gateway is answering, whatever one poll said.
  const unreachable = overview.isLoadingError || (overview.isRefetchError && !streamIsLive);
  if (unreachable) return { kind: "unreachable", lastSeenAt: lastSeenAt(overview) };
  if (!overview.data) return { kind: "loading" };
  return {
    kind: "data",
    overview: overview.data,
    tenantNames: new Map(tenants?.map((tenant) => [tenant.id, tenant.name])),
  };
}

function Snapshot({ at }: { at: string | null }) {
  if (!at) return null;
  return (
    <p className={`mono ${styles.snapshot}`}>
      {DATE.format(new Date(at))}
      <br />
      <TimeOfDay at={at} millis={false} /> UTC
    </p>
  );
}

export function OverviewView() {
  const tenants = useTenants();
  const overview = useOverview();
  const streamIsLive = useConnectionState() === "live";
  const samples = useQueueTrend();
  const headline = overviewHeadline(headlineInput(overview, tenants.data, streamIsLive));
  // The queue and throughput numbers come from the stream while it is live,
  // so a failed REST refresh leaves only the other figures out of date.
  const staleFigures = streamIsLive
    ? "Webhook and billing figures"
    : "Queue, throughput, webhook and billing figures";

  return (
    <>
      <Section
        ruled={false}
        context={<Snapshot at={lastSeenAt(overview)} />}
        bodyClassName={styles.top}
      >
        <div>
          <OverviewHeadline headline={headline} />
          {/* The regions below keep their last numbers when a refresh fails. These say so. */}
          <div className={styles.notices}>
            <RefreshFailedNotice
              title="Tenant balances and message counts could not be refreshed"
              query={tenants}
            />
            <RefreshFailedNotice
              title={`${staleFigures} could not be refreshed`}
              query={overview}
            />
          </div>
        </div>
        <KeyFigures overview={overview.data} samples={samples} streamIsLive={streamIsLive} />
      </Section>
      <Pipeline query={tenants} />
      <TenantsTable query={tenants} billing={overview.data?.billing} />
      <ThroughputSection query={overview} />
      <RecentFailures />
    </>
  );
}
