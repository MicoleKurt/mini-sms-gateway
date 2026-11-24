"use client";

import { memo, type MouseEvent } from "react";
import type { Message } from "@/lib/api/schemas";
import { Money } from "@/components/ui/figures";
import { LiveValue } from "@/components/ui/live-value";
import { MessageId } from "@/components/ui/message-id";
import { StatusWord } from "@/components/ui/status";
import { Td, Tr } from "@/components/ui/table";
import { TimeOfDay } from "@/components/ui/time-of-day";
import { Tooltip } from "@/components/ui/tooltip";
import { secondsToFinal, splitListId } from "./list-format";
import styles from "./messages-table.module.css";

const ENCODING_LABEL = { GSM7: "GSM-7", UCS2: "UCS-2" } as const;

function ambiguousHint(count: number): string {
  const which = count === 1 ? "One submit attempt" : `${count} submit attempts`;
  return `${which} got no answer. The carrier may have taken the message more than once.`;
}

/** A small triangle in the attention ink: a submit nobody answered. */
function AmbiguousMark() {
  return (
    <svg aria-hidden viewBox="0 0 10 10" className="inline-block size-[9px] overflow-visible">
      <path d="M5 1 9.3 9H.7z" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

/** Attempts: 2 and more are bold; an unanswered attempt adds a mark with its explanation. */
function Attempts({ attempts, ambiguous }: { attempts: number; ambiguous: number }) {
  return (
    <span className="inline-flex items-baseline justify-end gap-1.5">
      {ambiguous > 0 ? (
        <Tooltip content={ambiguousHint(ambiguous)} focusable className="attn">
          <AmbiguousMark />
          <span className="sr-only">{ambiguous} without an answer, </span>
        </Tooltip>
      ) : null}
      <span
        className={
          attempts >= 2 ? "font-semibold text-ink" : attempts === 0 ? "zero" : "text-ink-2"
        }
      >
        {attempts}
      </span>
    </span>
  );
}

interface MessageRowProps {
  message: Message;
  /** It arrived after the list was first shown: it fades in. */
  arriving: boolean;
  /** How many leading characters every ID in view shares. */
  sharedId: number;
  /** Called for a click anywhere on the row. The ID link works without it. */
  onOpen: (id: string, inNewTab: boolean) => void;
}

function MessageRowComponent({ message, arriving, sharedId, onOpen }: MessageRowProps) {
  const final = secondsToFinal(message);

  // The whole row opens the message for a mouse. Keyboard and assistive
  // technology use the ID link, which is the real control.
  function handleClick(event: MouseEvent) {
    // The link and the attempts hint handle their own clicks.
    if ((event.target as Element).closest("a, button, [tabindex]")) return;
    // A click that ends a text selection is a copy, not a navigation.
    if (window.getSelection()?.toString()) return;
    onOpen(message.id, event.metaKey || event.ctrlKey);
  }

  return (
    <Tr hoverable arriving={arriving} onClick={handleClick} className="cursor-pointer">
      <Td mono pin>
        <TimeOfDay at={message.created_at} />
      </Td>
      <Td mono>
        <MessageId
          id={message.id}
          href={`/messages/${message.id}`}
          shared={sharedId}
          shownLength={splitListId(message.id).shown.length}
        />
      </Td>
      <Td clip title={message.tenant_name}>
        {message.tenant_name}
      </Td>
      <Td mono>{message.to}</Td>
      <Td mono className="text-ink-2">
        {message.from}
      </Td>
      <Td clip title={message.text} className="text-ink-2">
        {message.text}
      </Td>
      <Td className={styles.stuck}>
        <LiveValue value={message.status}>
          <StatusWord status={message.status} />
        </LiveValue>
      </Td>
      <Td mono className={message.encoding === "GSM7" ? "text-ink-2" : undefined}>
        {ENCODING_LABEL[message.encoding]}
      </Td>
      <Td numeric>{message.segments}</Td>
      <Td numeric>
        <Money micros={message.cost_micros} />
        {message.currency === "USD" ? null : (
          <span className="text-ink-3"> {message.currency}</span>
        )}
      </Td>
      <Td numeric>
        <Attempts attempts={message.attempts} ambiguous={message.ambiguous_attempts} />
      </Td>
      <Td numeric className={final === null ? "zero" : "text-ink-2"}>
        {final ?? (
          <>
            <span aria-hidden>–</span>
            <span className="sr-only">not final yet</span>
          </>
        )}
      </Td>
    </Tr>
  );
}

export const MessageRow = memo(MessageRowComponent);
