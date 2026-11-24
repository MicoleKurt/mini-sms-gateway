"use client";

import { cn } from "@/lib/cn";
import type { ConnectionState } from "@/lib/live/connection";
import { useConnectionState } from "@/lib/live/live-provider";
import { Tooltip } from "@/components/ui/tooltip";

const STATES: Record<ConnectionState, { label: string; dot: string; hint: string }> = {
  connecting: {
    label: "Connecting",
    dot: "bg-warn",
    hint: "Opening the live stream. Data refreshes every 15 seconds until it is open.",
  },
  live: {
    label: "Live",
    dot: "bg-ok",
    hint: "Connected to the live stream. Numbers update as events arrive.",
  },
  reconnecting: {
    label: "Reconnecting",
    dot: "bg-danger",
    hint: "The live stream dropped. Data refreshes every 15 seconds until it is back.",
  },
};

/** The state of the live stream: a dot and a label, announced when it changes. */
export function ConnectionIndicator() {
  const { label, dot, hint } = STATES[useConnectionState()];

  return (
    <Tooltip content={hint} focusable className="rounded-md">
      <span
        role="status"
        aria-live="polite"
        className="flex h-7 items-center gap-2 px-2 text-xs font-medium text-ink-muted"
      >
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", dot)} />
        {label}
      </span>
    </Tooltip>
  );
}
