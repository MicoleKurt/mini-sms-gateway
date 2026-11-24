import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { STATUS_LABEL, type MessageStatus } from "@/lib/status";

type Tone = "neutral" | "ok" | "warn" | "danger";

const TONES: Record<Tone, string> = {
  neutral: "bg-raised text-ink-muted",
  ok: "bg-ok-tint text-ok-ink",
  warn: "bg-warn-tint text-warn-ink",
  danger: "bg-danger-tint text-danger-ink",
};

const SHAPE = "inline-flex items-center gap-1.5 rounded font-medium whitespace-nowrap";
const SMALL = "h-5 px-1.5 text-xs";
const LARGE = "h-6 px-2 text-sm";

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return <span className={cn(SHAPE, SMALL, TONES[tone], className)}>{children}</span>;
}

/** A message status: a dot and a label on a tint. The label carries the meaning, the colour supports it. */
export function StatusBadge({ status, large = false }: { status: MessageStatus; large?: boolean }) {
  return (
    <span
      data-status={status}
      className={cn(SHAPE, large ? LARGE : SMALL, "bg-status-tint text-status-ink")}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-status" />
      {STATUS_LABEL[status]}
    </span>
  );
}
