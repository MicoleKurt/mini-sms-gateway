"use client";

import { ApiError, describeError } from "@/lib/api/client";
import { useTenants } from "@/lib/api/hooks";
import type { Tenant } from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";
import { filtersKey } from "@/lib/message-filters";
import { Button } from "@/components/ui/button";
import { Count } from "@/components/ui/figures";
import { LiveValue } from "@/components/ui/live-value";
import { Section } from "@/components/ui/section";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { FilterBar } from "./filter-bar";
import { LiveControl } from "./live-control";
import { MessagesTable } from "./messages-table";
import { StatusKey } from "./status-key";
import { useMessageFilters } from "./use-message-filters";
import { PAGE_SIZE, useMessageList } from "./use-message-list";

const TABLE_END_ID = "messages-table-end";

const READING_NOTE = "Newest first. Times are UTC, when the API accepted the message.";

/** The margin column: how many messages there are, how the list reads, and the status key. */
export function MessagesMargin({ tenants }: { tenants: Tenant[] | undefined }) {
  const total = tenants?.reduce((sum, tenant) => sum + tenant.total_messages, 0);
  return (
    <div>
      <h2 className="lbl text-ink">On record</h2>
      <p className="figure mt-1">
        {total === undefined ? (
          <span className="skel w-24" />
        ) : (
          <LiveValue value={total}>
            <Count value={total} dimZero={false} />
          </LiveValue>
        )}
      </p>
      <p className="sec-context">
        {tenants
          ? `messages, ${tenants.length === 1 ? "1 tenant" : `${tenants.length} tenants`}`
          : "messages"}
      </p>
      <p className="sec-context hide-narrow mt-3">{READING_NOTE}</p>
      <StatusKey className="hide-narrow mt-10" />
    </div>
  );
}

/** A 4xx from the list: the request was understood and refused, so retrying will not help. */
function isFilterProblem(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500;
}

export function MessagesView() {
  const { filters, hasFilters, setFilters, clearFilters } = useMessageFilters();
  const tenants = useTenants();
  const { query, messages, newCount, reload, live, setLive, polling } = useMessageList(filters);

  const failedWithoutData = query.isError && !query.data;
  const isEmpty = query.isSuccess && messages.length === 0;
  // A shared or hand-edited link can name a tenant that does not exist (a
  // slug instead of the ID). That is said plainly instead of as an API error.
  const unknownTenant =
    filters.tenant !== null &&
    tenants.data !== undefined &&
    !tenants.data.some((tenant) => tenant.id === filters.tenant);
  const clearAction = (
    <Button variant="quiet" onClick={clearFilters}>
      Clear filters
    </Button>
  );

  const placeholder = unknownTenant ? (
    <EmptyState
      title={`No tenant has the ID ${filters.tenant}.`}
      description="The link may hold a slug or an old ID. Pick a tenant from the list."
      action={clearAction}
    />
  ) : failedWithoutData && isFilterProblem(query.error) ? (
    <EmptyState
      title="The gateway did not accept these filters."
      description={describeError(query.error)}
      action={clearAction}
    />
  ) : failedWithoutData ? (
    <ErrorState
      title="Messages could not be loaded"
      error={query.error}
      onRetry={() => query.refetch()}
    />
  ) : isEmpty && hasFilters ? (
    <EmptyState
      title="No message matches these filters."
      description="Widen the time range or remove a filter. Search finds an exact message ID, destination number or client ref, not words in the text."
      action={clearAction}
    />
  ) : isEmpty ? (
    <EmptyState
      title="No messages yet."
      description="They appear here as soon as a tenant sends one. Send one yourself from Send test."
    />
  ) : undefined;

  return (
    <Section ruled={false} aside={<MessagesMargin tenants={tenants.data} />}>
      <h1 className="sr-only">Messages</h1>
      <FilterBar
        filters={filters}
        hasFilters={hasFilters}
        tenants={tenants.data}
        onChange={setFilters}
        onClear={clearFilters}
      />

      <div className="mt-7 mb-2">
        <LiveControl
          live={live}
          onLiveChange={setLive}
          polling={polling}
          newCount={newCount}
          onShowNew={reload}
          refreshing={query.isFetching}
          onRefresh={reload}
        />
      </div>

      {/* Every row holds a link. This lets a keyboard user get past all of them at once. */}
      <a
        href={`#${TABLE_END_ID}`}
        className="sr-only focus:not-sr-only focus:mb-2 focus:inline-block"
      >
        Skip to the end of the table
      </a>
      <MessagesTable
        messages={messages}
        listKey={JSON.stringify(filtersKey(filters))}
        loading={query.isPending && !unknownTenant}
        placeholder={placeholder}
      />

      <footer
        id={TABLE_END_ID}
        tabIndex={-1}
        className="mt-3 flex min-h-9 flex-wrap items-center justify-between gap-x-6 gap-y-2 text-ink-2 focus-visible:outline-none"
      >
        {query.isError && query.data ? (
          <p role="alert" className="attn">
            {query.isFetchNextPageError
              ? "Older messages could not be loaded."
              : "The list could not be refreshed."}{" "}
            {describeError(query.error)}
          </p>
        ) : (
          <p>
            {query.isSuccess && messages.length > 0 && !unknownTenant ? (
              <>
                <span className="num text-ink">{formatCount(messages.length)}</span> shown
                {query.hasNextPage ? null : ", the oldest is the last row"}
              </>
            ) : null}
            <span className="show-narrow mt-1 text-small">{READING_NOTE}</span>
          </p>
        )}
        {query.hasNextPage && !unknownTenant ? (
          <Button onClick={() => query.fetchNextPage()} aria-disabled={query.isFetchingNextPage}>
            {query.isFetchingNextPage ? "Loading older messages" : `Load ${PAGE_SIZE} older`}
          </Button>
        ) : null}
      </footer>
    </Section>
  );
}
