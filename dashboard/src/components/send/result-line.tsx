"use client";

import { useEffect, useRef } from "react";
import { useMessageDetail } from "@/lib/api/hooks";
import type { AcceptedMessage } from "@/lib/api/schemas";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Money } from "@/components/ui/figures";
import { MessageId } from "@/components/ui/message-id";
import { StatusWord } from "@/components/ui/status";
import { TimeOfDay } from "@/components/ui/time-of-day";
import { segmentCount } from "./send-copy";
import styles from "./send.module.css";

interface ResultLineProps {
  message: AcceptedMessage;
  /**
   * Removes the line. Pass it while the form still holds the draft of this
   * message: the form does not send that draft a second time until the line
   * is gone.
   */
  onClear?: () => void;
}

/**
 * The message that was just accepted, as one statement line: its ID as a
 * link, its current status, and what it cost. Render it with
 * `key={message.id}`, so each message gets its own line.
 */
export function ResultLine({ message, onClear }: ResultLineProps) {
  const heading = useRef<HTMLHeadingElement>(null);

  // The answer to the send always says ACCEPTED, and the event for the next
  // status is on the stream before this line exists. So the status is read
  // from the gateway. useMessageDetail refetches it on every later event and
  // polls it while the message is on its way, with or without the stream.
  const detail = useMessageDetail(message.id);
  const status = detail.data?.message.status ?? message.status;

  // The line appears below the form that was just submitted. Focus moves to
  // it, so a keyboard or screen reader user lands on the confirmation.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <section aria-labelledby="send-result" className={styles.result}>
      <div className={styles.resultHead}>
        <h2 id="send-result" ref={heading} tabIndex={-1} className="lbl">
          Last send
        </h2>
        <CopyButton value={message.id} label="Copy ID" />
        {onClear ? (
          <Button variant="quiet" onClick={onClear}>
            Clear
          </Button>
        ) : null}
      </div>
      <p className={styles.resultLine}>
        <MessageId id={message.id} href={`/messages/${message.id}`} />
        {/* Only the status is announced when it changes, not the whole line. */}
        <span aria-live="polite">
          <StatusWord status={status} />
        </span>
      </p>
      <p className={styles.resultMeta}>
        <Money micros={message.cost_micros} currency={message.currency} /> charged for{" "}
        {segmentCount(message.segments)}, accepted{" "}
        <TimeOfDay at={message.created_at} millis={false} /> UTC
      </p>
    </section>
  );
}
