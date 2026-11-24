"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  use,
  useEffect,
  useEffectEvent,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { GATEWAY_PROXY_PATH } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import type { Tenant } from "@/lib/api/schemas";
import {
  LiveConnection,
  type ConnectionState,
  type LiveEventMap,
  type LiveEventType,
} from "./connection";
import { recordStats, type LiveOverview } from "./live-overview";
import { applyStatsToTenants } from "./stats-cache";

const LiveContext = createContext<LiveConnection | null>(null);
const LiveOverviewContext = createContext<LiveOverview | null>(null);

/**
 * Owns the single stream connection of the app and keeps what "stats" events
 * report, so tenant cards, tiles and the chart update without polling.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [connection] = useState(
    () =>
      new LiveConnection(`${GATEWAY_PROXY_PATH}/stream`, () => {
        // The stream is best-effort: what it did not deliver is only in the
        // REST data, so everything on screen is fetched again.
        void queryClient.invalidateQueries();
      }),
  );
  const [liveOverview, setLiveOverview] = useState<LiveOverview | null>(null);

  useEffect(() => {
    const unsubscribeStats = connection.on("stats", (stats) => {
      queryClient.setQueryData<Tenant[]>(queryKeys.tenants, (tenants) =>
        applyStatsToTenants(tenants, stats),
      );
      // Not written into the overview query: see useOverview.
      setLiveOverview((live) => recordStats(live, stats));
    });
    // Without the stream these numbers would only get older, while the REST
    // poll of the overview keeps getting newer ones.
    const unsubscribeState = connection.subscribeState(() => {
      if (connection.getState() !== "live") setLiveOverview(null);
    });
    connection.start();
    return () => {
      unsubscribeStats();
      unsubscribeState();
      connection.stop();
    };
  }, [connection, queryClient]);

  return (
    <LiveContext value={connection}>
      <LiveOverviewContext value={liveOverview}>{children}</LiveOverviewContext>
    </LiveContext>
  );
}

/** What the stream has reported about the queue and throughput, or null while it is not live. */
export function useLiveOverview(): LiveOverview | null {
  return use(LiveOverviewContext);
}

function useLiveConnection(): LiveConnection {
  const connection = use(LiveContext);
  if (!connection) throw new Error("useLiveConnection must be used inside <LiveProvider>.");
  return connection;
}

export function useConnectionState(): ConnectionState {
  const connection = useLiveConnection();
  return useSyncExternalStore(connection.subscribeState, connection.getState, () => "connecting");
}

/** Run `handler` for every stream event of one type while `enabled` is true. */
export function useLiveEvent<Type extends LiveEventType>(
  type: Type,
  handler: (event: LiveEventMap[Type]) => void,
  enabled = true,
): void {
  const connection = useLiveConnection();
  const onEvent = useEffectEvent(handler);

  useEffect(() => {
    if (!enabled) return;
    return connection.on(type, (event) => onEvent(event));
  }, [connection, type, enabled]);
}
