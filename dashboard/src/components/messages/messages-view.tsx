"use client";

import { ArrowUp, Inbox, RefreshCw, SearchX } from "lucide-react";
import { useTenants } from "@/lib/api/hooks";
import { describeError } from "@/lib/api/client";
import { formatCount } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Switch } from "@/components/ui/switch";
import { FilterBar } from "./filter-bar";
import type { NewCount } from "./live-list";
import { MessagesTable } from "./messages-table";
import { useMessageFilters } from "./use-message-filters";
import { useMessageList } from "./use-message-list";

const TABLE_END_ID = "messages-table-end";

function newMessagesLabel({ count, orMore }: NewCount): string {
  if (orMore) return count === 0 ? "New messages" : `${formatCount(count)}+ new messages`;
  return count === 1 ? "1 new message" : `${formatCount(count)} new messages`;
}

export function MessagesView() {
  const { filters, hasFilters, setFilters, clearFilters } = useMessageFilters();
  const tenants = useTenants();
  const { query, messages, newCount, reload, live, setLive, polling } = useMessageList(filters);

  const failedWithoutData = query.isError && !query.data;
  const isEmpty = query.isSuccess && messages.length === 0;
  const hasNew = newCount.count > 0 || newCount.orMore;

  const placeholder = failedWithoutData ? (
    <ErrorState
      title="Messages could not be loaded"
      error={query.error}
      onRetry={() => query.refetch()}
    />
  ) : isEmpty && hasFilters ? (
    <EmptyState
      icon={<SearchX aria-hidden />}
      title="No messages match these filters"
      description="Widen the time range or remove a filter. Search only finds an exact message ID, destination number or client_ref."
      action={
        <Button size="sm" onClick={clearFilters}>
          Clear filters
        </Button>
      }
    />
  ) : isEmpty ? (
    <EmptyState
      icon={<Inbox aria-hidden />}
      title="No messages yet"
      description="Messages appear here as soon as a tenant sends one. You can send one yourself from the Send test page."
    />
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Messages"
        description="Every message of every tenant, newest first. Open a row for its full history."
        actions={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {polling ? (
              <p role="status" className="text-xs text-warn-ink">
                The live stream is down. Refreshing every 15 seconds.
              </p>
            ) : null}
            <div className="flex items-center gap-2">
              <Switch checked={live} onChange={setLive} label="Live updates" />
              <Button onClick={reload} aria-disabled={query.isFetching}>
                <RefreshCw aria-hidden className={query.isFetching ? "animate-spin" : undefined} />
                Refresh
              </Button>
            </div>
          </div>
        }
      />

      <Card>
        <div className="border-b border-line p-3">
          <FilterBar
            filters={filters}
            hasFilters={hasFilters}
            tenants={tenants.data}
            onChange={setFilters}
            onClear={clearFilters}
          />
        </div>

        <div className="relative">
          {/* Every row holds a link. This lets a keyboard user get past all of them at once. */}
          <a
            href={`#${TABLE_END_ID}`}
            className="sr-only rounded-md bg-primary px-3 py-2 text-on-primary focus:not-sr-only focus:absolute focus:top-1 focus:left-1 focus:z-20"
          >
            Skip to the end of the table
          </a>
          <MessagesTable messages={messages} loading={query.isPending} placeholder={placeholder} />
          {/* Over the table, not in the flow, so it never pushes the rows down. */}
          <div className="pointer-events-none absolute inset-x-0 top-11 flex justify-center">
            {hasNew ? (
              <button
                type="button"
                onClick={reload}
                className="pointer-events-auto flex h-7 animate-fade-in items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-medium text-on-primary shadow-md hover:bg-primary/85"
              >
                <ArrowUp aria-hidden className="size-3.5" />
                {newMessagesLabel(newCount)}
              </button>
            ) : null}
          </div>
          {/* The count on the button changes with every event. This says it once. */}
          <p role="status" className="sr-only">
            {hasNew ? "New messages are available. The button after the table loads them." : ""}
          </p>
        </div>

        <footer
          id={TABLE_END_ID}
          tabIndex={-1}
          className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-2 focus-visible:outline-none"
        >
          {query.isError && query.data ? (
            <p role="alert" className="text-xs text-danger-ink">
              {query.isFetchNextPageError
                ? "The next page could not be loaded."
                : "The list could not be refreshed."}{" "}
              {describeError(query.error)}
            </p>
          ) : (
            <p className="text-xs text-ink-muted">
              {query.isSuccess
                ? `${formatCount(messages.length)} loaded${query.hasNextPage ? "" : ", end of list"}`
                : null}
            </p>
          )}
          {query.hasNextPage ? (
            <Button onClick={() => query.fetchNextPage()} aria-disabled={query.isFetchingNextPage}>
              {query.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          ) : null}
        </footer>
      </Card>
    </>
  );
}
