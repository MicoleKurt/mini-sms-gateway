"use client";

import { useOverview, useTenants } from "@/lib/api/hooks";
import { useConnectionState } from "@/lib/live/live-provider";
import { PageHeader } from "@/components/layout/page-header";
import { RefreshFailedNotice } from "@/components/ui/states";
import { PipelineStrip } from "./pipeline-strip";
import { StatTiles } from "./stat-tiles";
import { TenantCards } from "./tenant-cards";
import { ThroughputChart } from "./throughput-chart";

export function OverviewView() {
  const tenants = useTenants();
  const overview = useOverview();
  // The queue and throughput numbers come from the stream while it is live,
  // so a failed REST refresh leaves only the other figures out of date.
  const staleFigures =
    useConnectionState() === "live"
      ? "Webhook and billing figures"
      : "Queue, throughput, webhook and billing figures";

  return (
    <>
      <PageHeader
        title="Overview"
        description="Where messages are in the pipeline, how fast they move and what each tenant has left."
      />
      <div className="flex flex-col gap-4">
        {/* The regions below keep their last numbers when a refresh fails. These say so. */}
        <RefreshFailedNotice
          title="Tenant balances and message counts could not be refreshed"
          query={tenants}
        />
        <RefreshFailedNotice title={`${staleFigures} could not be refreshed`} query={overview} />
        <PipelineStrip query={tenants} />
        <StatTiles overview={overview} tenants={tenants.data} />
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <ThroughputChart query={overview} />
          <TenantCards query={tenants} />
        </div>
      </div>
    </>
  );
}
