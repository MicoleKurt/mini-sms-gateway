"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useState } from "react";
import { listMessages } from "@/lib/api/endpoints";
import { FALLBACK_POLL_MS } from "@/lib/api/hooks";
import { queryKeys } from "@/lib/api/query-keys";
import { useConnectionState, useLiveEvent } from "@/lib/live/live-provider";
import { createdBounds, filtersKey, type MessageFilters } from "@/lib/message-filters";
import { EventBuffer } from "./event-buffer";
import {
  NOTHING_PENDING,
  patchLoaded,
  pendingCount,
  trackEvents,
  type MessagePages,
  type PendingNew,
} from "./live-list";

const PAGE_SIZE = 50;

// Under load the stream sends hundreds of events a second. Applying them a
// few times a second keeps the table responsive and is still live to the eye.
// A timer and not an animation frame, because frames stop in a hidden tab and
// the events would pile up for as long as it stays hidden.
const APPLY_INTERVAL_MS = 100;

/**
 * The message list for the given filters: cursor pages plus live updates.
 *
 * While live updates are on, an event for a loaded row patches that row in
 * the query cache. Events for newer messages only raise `newCount`. `reload`
 * then drops back to a fresh first page. While the stream is down the loaded
 * pages are polled instead (`polling`).
 */
export function useMessageList(filters: MessageFilters) {
  const queryClient = useQueryClient();
  const streamIsLive = useConnectionState() === "live";
  const [live, setLiveState] = useState(true);
  const polling = live && !streamIsLive;

  const queryKey = queryKeys.messageList(filtersKey(filters));
  const listId = JSON.stringify(queryKey);

  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam, signal }) => {
      const bounds = createdBounds(filters, Date.now());
      return listMessages(
        {
          tenant_id: filters.tenant,
          status: filters.status,
          created_from: bounds.from,
          created_to: bounds.to,
          q: filters.q,
          limit: PAGE_SIZE,
          cursor: pageParam,
        },
        signal,
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    refetchInterval: polling ? FALLBACK_POLL_MS : false,
  });

  // The count belongs to one list. Changing a filter starts again from zero.
  const [pending, setPending] = useState<{ listId: string; value: PendingNew }>({
    listId,
    value: NOTHING_PENDING,
  });
  const currentPending = pending.listId === listId ? pending.value : NOTHING_PENDING;
  const updatePending = (update: (value: PendingNew) => PendingNew) =>
    setPending((previous) => {
      const current = previous.listId === listId ? previous.value : NOTHING_PENDING;
      const next = update(current);
      // The same object back means no change, and lets React skip the render.
      return next === current && previous.listId === listId ? previous : { listId, value: next };
    });

  const [buffer] = useState(() => new EventBuffer());
  useLiveEvent("message", (event) => buffer.addMessage(event), live);
  useLiveEvent("batch", (event) => buffer.addBatch(event), live);

  const applyBufferedEvents = useEffectEvent(() => {
    // A fetch ends by replacing the cached pages with what it read, so a row
    // patched while it runs would go back to its older status, and a final
    // status gets no second event. Events wait until the fetch has settled.
    if (buffer.isEmpty || queryClient.isFetching({ queryKey }) > 0) return;

    const { events, overflowed } = buffer.drain();
    const pages = queryClient.getQueryData<MessagePages>(queryKey);
    if (!pages) return;
    if (overflowed) {
      void queryClient.invalidateQueries({ queryKey });
      return;
    }

    const now = Date.now();
    queryClient.setQueryData<MessagePages>(queryKey, patchLoaded(pages, events.messages));
    updatePending((value) => trackEvents(value, events, pages, filters, now));
  });

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => applyBufferedEvents(), APPLY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [live]);

  function setLive(next: boolean) {
    setLiveState(next);
    // Events were dropped while it was off, and a row that reached its final
    // status in that time gets no further one. Read the rows again.
    if (next) void queryClient.invalidateQueries({ queryKey });
  }

  function reload() {
    // Keep only the first page, so the refetch is one request and the list
    // starts again from the newest message.
    queryClient.setQueryData<MessagePages>(queryKey, (pages) =>
      pages ? { pages: pages.pages.slice(0, 1), pageParams: pages.pageParams.slice(0, 1) } : pages,
    );
    updatePending(() => NOTHING_PENDING);
    void query.refetch();
  }

  return {
    query,
    messages: query.data?.pages.flatMap((page) => page.data) ?? [],
    newCount: pendingCount(currentPending, query.data),
    reload,
    live,
    setLive,
    polling,
  };
}
