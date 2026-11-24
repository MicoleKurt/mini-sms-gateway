"use client";

import { useQueries } from "@tanstack/react-query";
import { useState } from "react";
import { listMessages } from "@/lib/api/endpoints";
import { FALLBACK_POLL_MS } from "@/lib/api/hooks";
import type { Message } from "@/lib/api/schemas";
import { useConnectionState, useLiveEvent } from "@/lib/live/live-provider";
import {
  FAILURE_STATUSES,
  RECENT_FAILURES_SHOWN,
  isFailure,
  mergeFailures,
} from "./recent-failures";

/**
 * The newest failed, undelivered and expired messages: one small query per
 * status, merged, then kept current by "message" events from the stream.
 * While the stream is down the queries poll instead.
 */
export function useRecentFailures() {
  const streamIsLive = useConnectionState() === "live";
  const queries = useQueries({
    queries: FAILURE_STATUSES.map((status) => ({
      queryKey: ["overview", "recent-failures", status] as const,
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        (await listMessages({ status, limit: RECENT_FAILURES_SHOWN }, signal)).data,
      refetchInterval: streamIsLive ? (false as const) : FALLBACK_POLL_MS,
    })),
  });

  const [arrived, setArrived] = useState<Message[]>([]);
  useLiveEvent("message", (event) => {
    if (!isFailure(event.status)) return;
    const message = { ...event.message, status: event.status };
    setArrived((held) => mergeFailures([[message], held]));
  });

  const failures = mergeFailures([arrived, ...queries.map((query) => query.data ?? [])]);
  const failed = queries.filter((query) => query.isError);

  return {
    failures,
    /** Messages that came from the stream rather than a fetch: their rows fade in. */
    arrivedIds: new Set(arrived.map((message) => message.id)),
    // Waiting only while nothing at all is known yet.
    isPending: failures.length === 0 && queries.some((query) => query.isPending),
    // An error only matters when it leaves the list without data.
    error: failures.length === 0 ? (failed[0]?.error ?? null) : null,
    retry: () => failed.forEach((query) => void query.refetch()),
  };
}
