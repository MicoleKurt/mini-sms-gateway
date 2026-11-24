import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { STATUS_LABEL, type MessageStatus } from "@/lib/status";

// Circles are the carrier's side of the pipeline, squares are ours.
const SHAPES: Record<MessageStatus, ReactNode> = {
  ACCEPTED: (
    <rect
      x="1.25"
      y="1.25"
      width="7.5"
      height="7.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  ),
  QUEUED: <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />,
  SUBMITTED: (
    <>
      <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 1a4 4 0 0 1 0 8z" fill="currentColor" />
    </>
  ),
  DELIVERED: <circle cx="5" cy="5" r="4.75" fill="currentColor" />,
  UNDELIVERED: (
    <>
      <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.2 7.8 7.8 2.2" stroke="currentColor" strokeWidth="1.5" />
    </>
  ),
  EXPIRED: <path d="M5 .5 9.5 5 5 9.5 .5 5z" fill="none" stroke="currentColor" strokeWidth="1.5" />,
  FAILED: <rect x=".5" y=".5" width="9" height="9" fill="currentColor" />,
};

/** The status shape alone, in the status fill. Decorative: pair it with a word. */
export function StatusMark({ status, className }: { status: MessageStatus; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 10 10" data-status={status} className={cn("st-mark", className)}>
      {SHAPES[status]}
    </svg>
  );
}

/**
 * A status as mark and word. Delivered is ink at regular weight; undelivered,
 * expired and failed are bold in their ink so they stand out in a long list.
 * `muted` sets both in ink-3, for a status with nothing in it: colour only
 * appears where there is something. Pass `children` to replace the word.
 */
export function StatusWord({
  status,
  muted = false,
  className,
  children,
}: {
  status: MessageStatus;
  muted?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <span data-status={status} data-muted={muted || undefined} className={cn("st", className)}>
      <StatusMark status={status} />
      {children ?? STATUS_LABEL[status]}
    </span>
  );
}
