"use client";

import { ArrowRight, CircleCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { useMessageDetail } from "@/lib/api/hooks";
import type { AcceptedMessage } from "@/lib/api/schemas";
import { formatMoney } from "@/lib/format";
import { StatusBadge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";

interface ResultCardProps {
  message: AcceptedMessage;
  /**
   * Removes the card. Pass it while the form still holds the draft of this
   * message: the form does not send that draft a second time until the card
   * is gone.
   */
  onClear?: () => void;
}

/**
 * The message that was just accepted, with its current status, so the user
 * can watch it move through the pipeline without leaving the page.
 * Render it with `key={message.id}`, so each message gets its own card.
 */
export function ResultCard({ message, onClear }: ResultCardProps) {
  const heading = useRef<HTMLHeadingElement>(null);

  // The answer to the send always says ACCEPTED, and the event for the next
  // status is on the stream before this card exists. So the status is read
  // from the gateway. useMessageDetail refetches it on every later event and
  // polls it while the message is on its way, with or without the stream.
  const detail = useMessageDetail(message.id);
  const status = detail.data?.message.status ?? message.status;

  // The card appears below the form that was just submitted. Focus moves to
  // it, so a keyboard or screen reader user lands on the confirmation.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <section
      aria-labelledby="send-result-heading"
      className="animate-fade-in rounded-lg border border-ok/40 bg-ok-tint p-4"
    >
      <h2
        id="send-result-heading"
        ref={heading}
        tabIndex={-1}
        className="flex items-center gap-1.5 font-semibold text-ok-ink focus-visible:outline-none"
      >
        <CircleCheck aria-hidden className="size-4" />
        Message accepted
      </h2>
      <dl className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-[auto_1fr]">
        <dt className="text-xs text-ink-muted sm:pt-1.5">Message ID</dt>
        <dd className="flex items-center gap-1 font-mono break-all text-ink">
          {message.id}
          <CopyButton value={message.id} label="Copy message ID" />
        </dd>
        <dt className="text-xs text-ink-muted sm:pt-0.5">Status</dt>
        {/* Only the status is announced when it changes, not the whole card. */}
        <dd aria-live="polite">
          <StatusBadge status={status} />
        </dd>
        <dt className="text-xs text-ink-muted">Charged</dt>
        <dd className="font-mono text-ink">
          {formatMoney(message.cost_micros, message.currency)}
          <span className="ml-2 font-sans text-xs text-ink-muted">
            {message.segments === 1 ? "1 segment" : `${message.segments} segments`}
          </span>
        </dd>
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link href={`/messages/${message.id}`} className={buttonClasses({ size: "sm" })}>
          Open message
          <ArrowRight aria-hidden />
        </Link>
        {onClear ? (
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear result
          </Button>
        ) : null}
      </div>
    </section>
  );
}
