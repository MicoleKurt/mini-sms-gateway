"use client";

import { Building2 } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { Tenant } from "@/lib/api/schemas";
import { formatCount, formatMoney } from "@/lib/format";
import { MESSAGE_STATUSES, STATUS_LABEL } from "@/lib/status";
import { Card } from "@/components/ui/card";
import { LoadingLabel, Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { StatusBar } from "./status-bar";

function TenantCard({ tenant }: { tenant: Tenant }) {
  return (
    <Card className="@container p-4" aria-label={tenant.name}>
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="truncate font-semibold text-ink">{tenant.name}</h3>
        <span className="font-mono text-xs text-ink-faint">{tenant.slug}</span>
      </header>

      <dl className="mt-3 flex items-end justify-between gap-3">
        <div>
          <dt className="text-xs text-ink-muted">Balance</dt>
          <dd className="font-mono text-2xl leading-8 font-semibold tracking-tight text-ink">
            {formatMoney(tenant.balance_micros, tenant.currency)}
          </dd>
        </div>
        <div className="text-right">
          <dt className="text-xs text-ink-muted">Opening balance</dt>
          <dd className="font-mono text-ink-muted">
            {formatMoney(tenant.opening_balance_micros, tenant.currency)}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex items-baseline justify-between text-xs text-ink-muted">
        <span>Messages by status</span>
        <span className="font-mono">{formatCount(tenant.total_messages)} total</span>
      </div>
      <div className="mt-1.5">
        <StatusBar counts={tenant.counts} total={tenant.total_messages} />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 @sm:grid-cols-4">
        {MESSAGE_STATUSES.map((status) => (
          <div key={status} data-status={status}>
            <dt className="flex items-center gap-1.5 text-xs text-ink-muted">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-status" />
              {STATUS_LABEL[status]}
            </dt>
            <dd className="pl-3 font-mono text-ink">{formatCount(tenant.counts[status])}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function TenantCardSkeleton() {
  return (
    <Card className="@container p-4">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="mt-4 h-11 w-40" />
      <Skeleton className="mt-5 h-2 w-full rounded-full" />
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 @sm:grid-cols-4">
        {MESSAGE_STATUSES.map((status) => (
          <Skeleton key={status} className="h-9" />
        ))}
      </div>
    </Card>
  );
}

function Cards({ query }: { query: UseQueryResult<Tenant[]> }) {
  if (query.isPending) {
    return (
      <div className="grid gap-4">
        <LoadingLabel>Loading tenants…</LoadingLabel>
        <TenantCardSkeleton />
        <TenantCardSkeleton />
      </div>
    );
  }

  // Only without any data. After a failed refresh the last balances stay up.
  if (query.isLoadingError) {
    return (
      <Card>
        <ErrorState
          className="min-h-60"
          title="Tenants could not be loaded"
          error={query.error}
          onRetry={() => query.refetch()}
        />
      </Card>
    );
  }

  if (query.data.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Building2 aria-hidden />}
          title="No tenants"
          description="The gateway returned an empty tenant list."
        />
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      {query.data.map((tenant) => (
        <TenantCard key={tenant.id} tenant={tenant} />
      ))}
    </div>
  );
}

/** One card per tenant. The data is kept current by "stats" events in the query cache. */
export function TenantCards({ query }: { query: UseQueryResult<Tenant[]> }) {
  return (
    <section aria-labelledby="tenants-heading">
      <h2 id="tenants-heading" className="sr-only">
        Tenants
      </h2>
      <Cards query={query} />
    </section>
  );
}
