"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { withLiveOverview } from "@/lib/live/live-overview";
import { useConnectionState, useLiveEvent, useLiveOverview } from "@/lib/live/live-provider";
import { getMessageDetail, getOverview, getPrices, getTenants } from "./endpoints";
import { queryKeys } from "./query-keys";
import type { MessageDetail, Overview } from "./schemas";

/** How often REST is asked for data that the stream is not delivering. */
export const FALLBACK_POLL_MS = 15_000;

const OPEN_DETAIL_POLL_MS = 2_000;

/**
 * Tenants are kept fresh by "stats" events on the stream, which carry every
 * field of a tenant that changes. Polling is only for the time the stream is
 * not live.
 */
export function useTenants() {
  const streamIsLive = useConnectionState() === "live";
  return useQuery({
    queryKey: queryKeys.tenants,
    queryFn: ({ signal }) => getTenants(signal),
    refetchInterval: streamIsLive ? false : FALLBACK_POLL_MS,
  });
}

export function useOverview() {
  const live = useLiveOverview();
  return useQuery({
    queryKey: queryKeys.overview,
    queryFn: ({ signal }) => getOverview(signal),
    // Webhook totals, the billing check and the carrier limit are not on the
    // stream, so this query polls at all times. That is why the stream's queue
    // and throughput numbers are merged in here and never written to the
    // cache entry: every cache write restarts the interval timer, and one
    // write a second would keep a 15 second poll from ever firing.
    refetchInterval: FALLBACK_POLL_MS,
    select: useCallback((overview: Overview) => withLiveOverview(overview, live), [live]),
  });
}

export function usePrices() {
  return useQuery({
    queryKey: queryKeys.prices,
    queryFn: ({ signal }) => getPrices(signal),
    staleTime: 5 * 60_000,
  });
}

/** True while the gateway is still working on the message, so more records will follow. */
function hasOpenRecords({ message, attempts, webhooks }: MessageDetail): boolean {
  return (
    message.finalized_at === null ||
    attempts.some((attempt) => attempt.outcome === null) ||
    webhooks.some((webhook) => webhook.status === "PENDING")
  );
}

/**
 * Everything the gateway recorded about one message.
 *
 * A "message" event on the stream triggers a refetch, but the stream only
 * reports status changes. Submit retries, webhook attempts and repeated
 * delivery receipts change the record without an event, so the detail also
 * polls: quickly while something is open, slowly once the message has settled
 * (a duplicate receipt can still arrive then).
 */
export function useMessageDetail(id: string) {
  const queryClient = useQueryClient();

  useLiveEvent("message", (event) => {
    if (event.id === id) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.messageDetail(id) });
    }
  });

  return useQuery({
    queryKey: queryKeys.messageDetail(id),
    queryFn: ({ signal }) => getMessageDetail(id, signal),
    refetchInterval: ({ state }) =>
      state.data && hasOpenRecords(state.data) ? OPEN_DETAIL_POLL_MS : FALLBACK_POLL_MS,
  });
}
