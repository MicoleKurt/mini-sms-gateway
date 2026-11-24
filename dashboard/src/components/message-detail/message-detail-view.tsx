"use client";

import { ArrowLeft, FileQuestionMark } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ApiError } from "@/lib/api/client";
import { useMessageDetail } from "@/lib/api/hooks";
import type { Message, MessageDetail } from "@/lib/api/schemas";
import { formatDateTime, formatMoney, localZoneLabel } from "@/lib/format";
import { StatusBadge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { LoadingLabel, Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, RefreshFailedNotice } from "@/components/ui/states";
import { Timeline } from "./timeline";
import { buildTimeline } from "./timeline-items";

const ENCODING_LABEL = { GSM7: "GSM-7", UCS2: "UCS-2" } as const;

function BackLink() {
  return (
    <Link
      href="/messages"
      className={buttonClasses({ variant: "ghost", size: "sm", className: "-ml-2" })}
    >
      <ArrowLeft aria-hidden />
      Messages
    </Link>
  );
}

function Fact({
  label,
  mono = false,
  children,
}: {
  label: string;
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className={mono ? "mt-0.5 font-mono break-all text-ink" : "mt-0.5 break-words text-ink"}>
        {children ?? <span className="text-ink-faint">None</span>}
      </dd>
    </div>
  );
}

function attemptsText(message: Message): string {
  if (message.ambiguous_attempts === 0) return String(message.attempts);
  return `${message.attempts} (${message.ambiguous_attempts} without an answer)`;
}

function Header({ message }: { message: Message }) {
  return (
    <header className="mb-6">
      <BackLink />
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <StatusBadge status={message.status} large />
        <h1 className="flex min-w-0 items-center gap-1 font-mono text-lg font-semibold tracking-tight break-all text-ink">
          {message.id}
          <CopyButton value={message.id} label="Copy message ID" />
        </h1>
      </div>
      <p className="mt-1 text-ink-muted">
        {message.tenant_name}, created{" "}
        <time dateTime={message.created_at} className="font-mono">
          {formatDateTime(message.created_at)}
        </time>
      </p>
    </header>
  );
}

function Loaded({ detail }: { detail: MessageDetail }) {
  const { message } = detail;

  return (
    <>
      <Header message={message} />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Message" />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 sm:grid-cols-3 xl:grid-cols-2">
              <Fact label="To" mono>
                {message.to}
              </Fact>
              <Fact label="From" mono>
                {message.from}
              </Fact>
              <Fact label="Client reference" mono>
                {message.client_ref}
              </Fact>
              <Fact label="Encoding">{ENCODING_LABEL[message.encoding]}</Fact>
              <Fact label="Segments" mono>
                {message.segments}
              </Fact>
              <Fact label="Cost" mono>
                {formatMoney(message.cost_micros, message.currency)}
              </Fact>
              <Fact label="Attempts" mono>
                {attemptsText(message)}
              </Fact>
              <Fact label="Carrier ID" mono>
                {message.carrier_id}
              </Fact>
              <Fact label="Failure reason">{message.failure_reason}</Fact>
              <Fact label="Batch ID" mono>
                {message.batch_id}
              </Fact>
            </dl>
          </Card>

          <Card>
            <CardHeader
              title="Text"
              description={`${Array.from(message.text).length} characters`}
            />
            <p className="m-4 rounded-md border border-line bg-raised p-3 leading-6 break-words whitespace-pre-wrap text-ink">
              {message.text}
            </p>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="History"
            description={`Status changes, submit attempts, delivery receipts, ledger entries and webhooks, oldest first. Times are local, ${localZoneLabel()}.`}
          />
          <div className="p-4">
            <Timeline items={buildTimeline(detail)} />
          </div>
        </Card>
      </div>
    </>
  );
}

function LoadingState() {
  return (
    <div>
      <LoadingLabel>Loading the message…</LoadingLabel>
      <header className="mb-6">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="mt-2 h-7 w-96 max-w-full" />
        <Skeleton className="mt-2 h-5 w-64" />
      </header>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-72 rounded-lg" />
          <Skeleton className="h-36 rounded-lg" />
        </div>
        <Skeleton className="h-[30rem] rounded-lg" />
      </div>
    </div>
  );
}

export function MessageDetailView({ id }: { id: string }) {
  const query = useMessageDetail(id);

  if (query.isPending) return <LoadingState />;

  if (query.isLoadingError) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <>
        <BackLink />
        <Card className="mt-4">
          {notFound ? (
            <EmptyState
              className="min-h-72"
              icon={<FileQuestionMark aria-hidden />}
              title="Message not found"
              description={`The gateway has no message with the ID ${id}.`}
              action={
                <Link href="/messages" className={buttonClasses({ size: "sm" })}>
                  Back to messages
                </Link>
              }
            />
          ) : (
            <ErrorState
              className="min-h-72"
              title="This message could not be loaded"
              error={query.error}
              onRetry={() => query.refetch()}
            />
          )}
        </Card>
      </>
    );
  }

  return (
    <>
      {/* The page keeps the last record when a refresh fails. Without this it would look current. */}
      <RefreshFailedNotice
        className="mb-4"
        title="This message could not be refreshed"
        query={query}
      />
      <Loaded detail={query.data} />
    </>
  );
}
