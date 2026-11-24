"use client";

import type { ReactNode } from "react";
import { ApiError } from "@/lib/api/client";
import { useMessageDetail } from "@/lib/api/hooks";
import type { MessageDetail } from "@/lib/api/schemas";
import { Section } from "@/components/ui/section";
import { LoadingState, ErrorState, RefreshFailedNotice } from "@/components/ui/states";
import { BackToMessages, DetailHeader } from "./detail-header";
import { buildHistory } from "./history-rows";
import { HistoryTable } from "./history-table";
import { MessageFacts } from "./message-facts";
import { TimeStrip } from "./time-strip";

function Loaded({ detail, notice }: { detail: MessageDetail; notice: ReactNode }) {
  return (
    <>
      <DetailHeader detail={detail} notice={notice} />
      <TimeStrip detail={detail} />
      <Section
        label="History"
        context="Status events, submit attempts, receipts, ledger and webhooks, oldest first"
        bodyClassName="grid gap-x-14 gap-y-10 min-[1200px]:grid-cols-[minmax(0,1fr)_minmax(0,328px)]"
      >
        <HistoryTable rows={buildHistory(detail)} />
        <MessageFacts message={detail.message} />
      </Section>
    </>
  );
}

function NotFound({ id }: { id: string }) {
  return (
    <Section ruled={false} aside={<BackToMessages />}>
      <h1 className="headline">No message has this ID.</h1>
      <p className="num mt-2 text-ink-2 [overflow-wrap:anywhere]">{id}</p>
      <p className="lede">
        Check the link. To find a message by its number or client ref, search on the Messages page.
      </p>
    </Section>
  );
}

export function MessageDetailView({ id }: { id: string }) {
  const query = useMessageDetail(id);

  if (query.isPending) {
    return (
      <Section ruled={false} aside={<BackToMessages />}>
        {/* Display-size lines in the shape of the headline that is coming. */}
        <div className="headline">
          <LoadingState label="Loading the message" lines={2} widths={["88%", "52%"]} />
        </div>
      </Section>
    );
  }

  if (query.isLoadingError) {
    if (query.error instanceof ApiError && query.error.status === 404) return <NotFound id={id} />;
    return (
      <Section ruled={false} aside={<BackToMessages />}>
        <h1 className="sr-only">Message {id}</h1>
        <ErrorState
          title="This message could not be loaded"
          error={query.error}
          onRetry={() => query.refetch()}
        />
      </Section>
    );
  }

  return (
    <Loaded
      detail={query.data}
      notice={
        // The page keeps the last record when a refresh fails. Without this it would look current.
        <RefreshFailedNotice
          className="mb-4"
          title="This message could not be refreshed"
          query={query}
        />
      }
    />
  );
}
