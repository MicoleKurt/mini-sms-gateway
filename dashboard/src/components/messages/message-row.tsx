"use client";

import { TriangleExclamationPoint } from "lucide-react";
import Link from "next/link";
import { memo, useEffect, useRef, type MouseEvent } from "react";
import type { Message } from "@/lib/api/schemas";
import { cn } from "@/lib/cn";
import { formatAge, formatDateTime, formatMoney, formatRowTime } from "@/lib/format";
import { StatusBadge } from "@/components/ui/badge";
import { Td } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";

const ENCODING_LABEL = { GSM7: "GSM-7", UCS2: "UCS-2" } as const;

const AMBIGUOUS_HINT = "An attempt had no answer. The carrier may have accepted it more than once.";

/** For the columns a phone has no room for. It keeps time, status, destination, cost and attempts. */
export const WIDE_ONLY = "hidden md:table-cell";

interface MessageRowProps {
  message: Message;
  /** The current time, for the relative age. */
  now: number;
  /** Called for a click anywhere on the row. The link in the first cell works without it. */
  onOpen: (id: string, inNewTab: boolean) => void;
}

/** Flash the row when its status changes after it was first shown. */
function useFlashOnChange(status: string) {
  const row = useRef<HTMLTableRowElement>(null);
  const shownStatus = useRef(status);

  useEffect(() => {
    if (shownStatus.current === status) return;
    shownStatus.current = status;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    row.current?.animate(
      [{ backgroundColor: "var(--flash)" }, { backgroundColor: "transparent" }],
      {
        duration: 1_200,
        easing: "ease-out",
      },
    );
  }, [status]);

  return row;
}

function MessageRowComponent({ message, now, onOpen }: MessageRowProps) {
  const row = useFlashOnChange(message.status);
  const age = formatAge(message.created_at, now);

  // The whole row opens the message for a mouse. Keyboard and assistive
  // technology use the link in the first cell, which is the real control.
  function handleClick(event: MouseEvent) {
    // The link and the hint icon handle their own clicks.
    if ((event.target as Element).closest("a, button, [tabindex]")) return;
    // A click that ends a text selection is a copy, not a navigation.
    if (window.getSelection()?.toString()) return;
    onOpen(message.id, event.metaKey || event.ctrlKey);
  }

  return (
    <tr
      ref={row}
      onClick={handleClick}
      className="cursor-pointer border-b border-line last:border-b-0 hover:bg-raised has-[a:focus-visible]:bg-raised"
    >
      <Td>
        <Tooltip content={<span className="font-mono">{formatDateTime(message.created_at)}</span>}>
          <Link href={`/messages/${message.id}`} className="rounded hover:underline">
            <time dateTime={message.created_at} className="font-mono">
              {formatRowTime(message.created_at, now)}
            </time>
            {/* The space is for the link's name, which would otherwise read "23:04:0542s ago". */}
            {age ? (
              <span className="ml-1 hidden text-xs text-ink-faint sm:inline"> {age}</span>
            ) : null}
          </Link>
        </Tooltip>
      </Td>
      <Td>
        <StatusBadge status={message.status} />
      </Td>
      <Td className={cn(WIDE_ONLY, "max-w-40 truncate")}>{message.tenant_name}</Td>
      <Td className="font-mono">{message.to}</Td>
      <Td className={cn(WIDE_ONLY, "font-mono text-ink-muted")}>{message.from}</Td>
      <Td className={cn(WIDE_ONLY, "text-ink-muted")}>{ENCODING_LABEL[message.encoding]}</Td>
      <Td align="right" className={cn(WIDE_ONLY, "font-mono")}>
        {message.segments}
      </Td>
      <Td align="right" className="font-mono">
        {formatMoney(message.cost_micros, message.currency)}
      </Td>
      <Td align="right">
        <span className="inline-flex items-center justify-end gap-1.5">
          {message.ambiguous_attempts > 0 ? (
            <Tooltip content={AMBIGUOUS_HINT} focusable className="flex rounded text-warn">
              <TriangleExclamationPoint aria-label="Ambiguous attempt" className="size-3.5" />
            </Tooltip>
          ) : null}
          <span
            className={cn(
              "font-mono",
              message.attempts > 1 ? "font-semibold text-warn-ink" : "text-ink-muted",
            )}
          >
            {message.attempts}
          </span>
        </span>
      </Td>
    </tr>
  );
}

export const MessageRow = memo(MessageRowComponent);
