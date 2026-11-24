"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import type { Overview, Tenant } from "@/lib/api/schemas";
import { sumCounts } from "@/lib/status";
import { Count, Money } from "@/components/ui/figures";
import { Section } from "@/components/ui/section";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { NoteRow, Table, Td, Th, Tr } from "@/components/ui/table";
import { formatShare, joinNames } from "./overview-format";
import styles from "./overview.module.css";
import { StatusStrip } from "./status-strip";

const COLUMNS = 11;

type Billing = Overview["billing"][number];

function LedgerCell({ billing }: { billing: Billing | undefined }) {
  if (!billing) return <Td className="zero">not checked</Td>;
  if (!billing.consistent) {
    return <Td className="attn font-semibold">Mismatch</Td>;
  }
  if (billing.double_charged > 0) {
    return (
      <Td className="attn font-semibold">
        <Count value={billing.double_charged} /> charged twice
      </Td>
    );
  }
  return <Td className="text-ink-2">Balanced</Td>;
}

function TenantRow({ tenant, billing }: { tenant: Tenant; billing: Billing | undefined }) {
  const { counts } = tenant;
  return (
    <Tr>
      <Td pin>
        <span className={styles.tenantName} title={tenant.name}>
          <span>{tenant.name}</span>
          <span className={`mono ${styles.slug}`}>{tenant.slug}</span>
        </span>
      </Td>
      <Td numeric className="font-medium">
        <Money micros={tenant.balance_micros} />
      </Td>
      <Td numeric wideOnly className="text-ink-2">
        <Money micros={tenant.opening_balance_micros} />
      </Td>
      <Td numeric wideOnly className="text-ink-2">
        <Money micros={tenant.opening_balance_micros - tenant.balance_micros} />
      </Td>
      <Td>
        <span className={styles.outcomes}>
          <StatusStrip counts={counts} className={styles.outcomeStrip} />
          <span className="num">{formatShare(counts.DELIVERED, tenant.total_messages)}%</span>
        </span>
      </Td>
      <Td numeric>
        <Count value={counts.DELIVERED} />
      </Td>
      <Td numeric>
        <Count value={counts.UNDELIVERED} />
      </Td>
      <Td numeric>
        <Count value={counts.EXPIRED} />
      </Td>
      <Td numeric>
        <Count value={counts.FAILED} />
      </Td>
      <Td numeric>
        <Count value={tenant.total_messages} />
      </Td>
      <LedgerCell billing={billing} />
    </Tr>
  );
}

function TotalRow({ tenants, billing }: { tenants: Tenant[]; billing: Billing[] | undefined }) {
  const counts = sumCounts(tenants.map((tenant) => tenant.counts));
  const total = tenants.reduce((sum, tenant) => sum + tenant.total_messages, 0);
  const balance = tenants.reduce((sum, tenant) => sum + tenant.balance_micros, 0);
  const opening = tenants.reduce((sum, tenant) => sum + tenant.opening_balance_micros, 0);
  // Amounts in different currencies do not add up to anything.
  const oneCurrency = new Set(tenants.map((tenant) => tenant.currency)).size === 1;
  const balanced = billing?.filter((entry) => entry.consistent && entry.double_charged === 0);

  return (
    <Tr variant="total">
      <Td pin>Total</Td>
      <Td numeric>{oneCurrency ? <Money micros={balance} /> : null}</Td>
      <Td numeric wideOnly>
        {oneCurrency ? <Money micros={opening} /> : null}
      </Td>
      <Td numeric wideOnly>
        {oneCurrency ? <Money micros={opening - balance} /> : null}
      </Td>
      <Td>
        <span className="num hide-narrow font-normal text-ink-2">
          {formatShare(counts.DELIVERED, total)}% delivered
        </span>
      </Td>
      <Td numeric>
        <Count value={counts.DELIVERED} />
      </Td>
      <Td numeric>
        <Count value={counts.UNDELIVERED} />
      </Td>
      <Td numeric>
        <Count value={counts.EXPIRED} />
      </Td>
      <Td numeric>
        <Count value={counts.FAILED} />
      </Td>
      <Td numeric>
        <Count value={total} />
      </Td>
      <Td>{balanced && billing ? `${balanced.length} of ${billing.length}` : null}</Td>
    </Tr>
  );
}

/** The reconciliation the gateway runs, with its formula, under the table. */
function LedgerLine({ tenants, billing }: { tenants: Tenant[]; billing: Billing[] }) {
  const names = new Map(tenants.map((tenant) => [tenant.id, tenant.name]));
  const failing = billing
    .filter((entry) => !entry.consistent)
    .map((entry) => names.get(entry.tenant_id) ?? entry.tenant_id);
  const doubles = billing.reduce((sum, entry) => sum + entry.double_charged, 0);

  return (
    <p className={styles.ledgerLine}>
      Ledger check, <span className={styles.formula}>opening − charges + refunds = balance</span>
      {failing.length > 0 ? (
        <>
          : <b className="attn">does not hold for {joinNames(failing)}</b>
        </>
      ) : (
        <>
          : holds for <Count value={billing.length} /> of <Count value={billing.length} /> tenants
        </>
      )}
      ;{" "}
      {doubles > 0 ? (
        <b className="attn">
          <Count value={doubles} /> double {doubles === 1 ? "charge" : "charges"}
        </b>
      ) : (
        <>
          <Count value={0} dimZero={false} /> double charges
        </>
      )}
      .
    </p>
  );
}

function Rows({
  query,
  billing,
}: {
  query: UseQueryResult<Tenant[]>;
  billing: Billing[] | undefined;
}) {
  if (query.data) {
    if (query.data.length === 0) {
      return (
        <NoteRow colSpan={COLUMNS}>
          <EmptyState
            title="No tenants."
            description="The gateway returned an empty tenant list; tenants are created by its seed data."
          />
        </NoteRow>
      );
    }
    const byTenant = new Map(billing?.map((entry) => [entry.tenant_id, entry]));
    return (
      <>
        {query.data.map((tenant) => (
          <TenantRow key={tenant.id} tenant={tenant} billing={byTenant.get(tenant.id)} />
        ))}
        <TotalRow tenants={query.data} billing={billing} />
      </>
    );
  }
  return (
    <NoteRow colSpan={COLUMNS}>
      {query.isLoadingError ? (
        <ErrorState
          title="Tenants could not be loaded"
          error={query.error}
          onRetry={() => query.refetch()}
        />
      ) : (
        <LoadingState label="Loading tenants" lines={2} widths={["100%", "100%"]} />
      )}
    </NoteRow>
  );
}

/**
 * One row per tenant: what it has left, what its messages came to, and
 * whether its ledger reconciles. Balances and counts follow the stream; the
 * ledger check comes from the overview poll.
 */
export function TenantsTable({
  query,
  billing,
}: {
  query: UseQueryResult<Tenant[]>;
  billing: Billing[] | undefined;
}) {
  const currency = query.data?.[0]?.currency ?? "USD";
  return (
    <Section
      label="Tenants"
      context={`Prepaid balances in ${currency}; counts are records since the opening balance`}
    >
      <Table scrollX>
        <thead>
          <tr>
            <Th pin>Tenant</Th>
            <Th numeric>Balance</Th>
            <Th numeric wideOnly>
              Opening
            </Th>
            <Th numeric wideOnly>
              Used
            </Th>
            <Th>Outcomes</Th>
            <Th numeric>Delivered</Th>
            <Th numeric>Undelivered</Th>
            <Th numeric>Expired</Th>
            <Th numeric>Failed</Th>
            <Th numeric>Messages</Th>
            <Th>Ledger</Th>
          </tr>
        </thead>
        <tbody>
          <Rows query={query} billing={billing} />
        </tbody>
      </Table>
      {query.data && query.data.length > 0 && billing ? (
        <LedgerLine tenants={query.data} billing={billing} />
      ) : null}
    </Section>
  );
}
