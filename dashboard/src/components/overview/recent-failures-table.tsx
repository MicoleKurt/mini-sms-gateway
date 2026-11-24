"use client";

import Link from "next/link";
import type { Message } from "@/lib/api/schemas";
import { sharedIdPrefix } from "@/lib/format";
import { MessageId } from "@/components/ui/message-id";
import { Section } from "@/components/ui/section";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusWord } from "@/components/ui/status";
import { NoteRow, Table, Td, Th, Tr } from "@/components/ui/table";
import { TimeOfDay } from "@/components/ui/time-of-day";
import { RECENT_FAILURES_SHOWN, failedAt } from "./recent-failures";
import { useRecentFailures } from "./use-recent-failures";

const COLUMNS = 6;

/** The gateway's reason when it has one; otherwise what the carrier's receipt said, in words. */
function Reason({ message }: { message: Message }) {
  if (message.failure_reason) return <span className="mono">{message.failure_reason}</span>;
  if (message.status === "EXPIRED") return <>validity ran out at the carrier</>;
  if (message.status === "UNDELIVERED") return <>the carrier could not deliver it</>;
  return <span className="zero">no reason recorded</span>;
}

function FailureRow({
  message,
  arriving,
  sharedId,
}: {
  message: Message;
  arriving: boolean;
  sharedId: number;
}) {
  const href = `/messages/${message.id}`;
  return (
    <Tr arriving={arriving}>
      {/* The time is a link as well: on a phone it is the one column always in view. */}
      <Td pin>
        <Link href={href} aria-describedby={`failure-${message.id}`}>
          <TimeOfDay at={failedAt(message)} />
        </Link>
      </Td>
      <Td>
        <StatusWord status={message.status} />
        <span className="show-narrow mt-0.5 text-small text-ink-2">
          <Reason message={message} />
        </span>
      </Td>
      <Td clip title={message.tenant_name}>
        {message.tenant_name}
      </Td>
      <Td mono wideOnly>
        {message.to}
      </Td>
      <Td wideOnly>
        <Reason message={message} />
      </Td>
      <Td>
        <MessageId id={message.id} href={href} shared={sharedId} />
        <span id={`failure-${message.id}`} hidden>
          Message {message.id}
        </span>
      </Td>
    </Tr>
  );
}

/**
 * The newest failed, undelivered and expired messages, each a link to its
 * detail. A delivered message never appears here.
 */
export function RecentFailures() {
  const { failures, arrivedIds, isPending, error, retry } = useRecentFailures();
  const sharedId = sharedIdPrefix(failures.map((message) => message.id));

  return (
    <Section
      label="Recent failures"
      context={`The newest ${RECENT_FAILURES_SHOWN} failed, undelivered or expired messages, live`}
    >
      <Table compact scrollX>
        <thead>
          <tr>
            <Th pin>Outcome at, UTC</Th>
            <Th>Status</Th>
            <Th>Tenant</Th>
            <Th wideOnly>To</Th>
            <Th wideOnly>Reason</Th>
            <Th>Message</Th>
          </tr>
        </thead>
        <tbody>
          {failures.map((message) => (
            <FailureRow
              key={message.id}
              message={message}
              arriving={arrivedIds.has(message.id)}
              sharedId={sharedId}
            />
          ))}
          {failures.length === 0 ? (
            <NoteRow colSpan={COLUMNS}>
              {error ? (
                <ErrorState
                  title="Recent failures could not be loaded"
                  error={error}
                  onRetry={retry}
                />
              ) : isPending ? (
                <LoadingState label="Loading recent failures" lines={2} widths={["100%", "100%"]} />
              ) : (
                <EmptyState
                  title="No message has failed, gone undelivered or expired."
                  description="Failures will appear here as they happen."
                />
              )}
            </NoteRow>
          ) : null}
        </tbody>
      </Table>
    </Section>
  );
}
