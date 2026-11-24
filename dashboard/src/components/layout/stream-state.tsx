"use client";

import { useState } from "react";
import { TimeOfDay } from "@/components/ui/time-of-day";
import type { ConnectionState } from "@/lib/live/connection";
import { useConnectionState, useLiveEvent } from "@/lib/live/live-provider";

const WORDS: Record<ConnectionState, string> = {
  connecting: "Connecting",
  live: "Stream connected",
  reconnecting: "Reconnecting",
};

/** When the stream last spoke. The gateway sends "stats" every second. */
function useLastEventAt(): string | null {
  const [at, setAt] = useState<string | null>(null);
  useLiveEvent("stats", (stats) => setAt(stats.at));
  return at;
}

/**
 * The live stream's state in words, and the time of its last event, so a
 * stale screen says how stale it is. Only the state is announced; the time
 * changes every second and is not.
 */
export function StreamState() {
  const state = useConnectionState();
  const lastAt = useLastEventAt();

  return (
    <p className="stream" data-state={state}>
      <span role="status" className="stream-state">
        {WORDS[state]}
      </span>
      {lastAt ? (
        <span className="mono">
          last event <TimeOfDay at={lastAt} millis={false} /> UTC
        </span>
      ) : null}
    </p>
  );
}
