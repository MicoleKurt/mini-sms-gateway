/**
 * How stream events change the message list. These are pure functions over
 * the cached pages and a small "pending" record, so the rules can be tested
 * without a browser:
 *
 *  - an event for a row that is loaded patches that row in place;
 *  - an event for a newer message that the filters would return is counted,
 *    not inserted, so the list never moves under the user.
 */
import type { InfiniteData } from "@tanstack/react-query";
import type { BatchEvent, MessageEvent, MessageListResponse } from "@/lib/api/schemas";
import { epochMicros } from "@/lib/format";
import { batchCouldMatch, matchesFilters, type MessageFilters } from "@/lib/message-filters";
import { statusRank } from "@/lib/status";
import type { HeldEvents } from "./event-buffer";

export type MessagePages = InfiniteData<MessageListResponse>;

/** How many messages, and how many batches, are tracked one by one. */
export const MAX_TRACKED = 1_000;

/** What the stream has announced that is not in the list yet. Times are in microseconds. */
export interface PendingNew {
  /** Unloaded messages that would be in the list. */
  messages: ReadonlyMap<string, { batchId: string | null; createdAt: number }>;
  /** Batches counted as a whole. */
  batches: ReadonlyMap<string, { count: number; acceptedAt: number }>;
  /** When the newest message or batch beyond MAX_TRACKED was created, or null if all fit. */
  untrackedAt: number | null;
}

export const NOTHING_PENDING: PendingNew = {
  messages: new Map(),
  batches: new Map(),
  untrackedAt: null,
};

export interface NewCount {
  count: number;
  /** True when there are more than `count`, because not all of them could be tracked. */
  orMore: boolean;
}

/** When the first loaded row was created. An empty list is older than everything. */
function newestLoadedAt(pages: MessagePages | undefined): number {
  const newest = pages?.pages[0]?.data[0];
  return newest ? epochMicros(newest.created_at) : -Infinity;
}

/**
 * How many new messages are waiting. Only entries newer than the first loaded
 * row count, so a refetch that brings them in lowers the number by itself.
 */
export function pendingCount(pending: PendingNew, pages: MessagePages | undefined): NewCount {
  const loadedAt = newestLoadedAt(pages);
  let count = 0;
  for (const { createdAt } of pending.messages.values()) {
    if (createdAt > loadedAt) count += 1;
  }
  for (const batch of pending.batches.values()) {
    if (batch.acceptedAt > loadedAt) count += batch.count;
  }
  return { count, orMore: pending.untrackedAt !== null && pending.untrackedAt > loadedAt };
}

/** Drop what a refetch has brought into the list, so it does not use up MAX_TRACKED. */
function forgetLoaded(pending: PendingNew, pages: MessagePages): PendingNew {
  const loadedAt = newestLoadedAt(pages);
  const messages = new Map(
    [...pending.messages].filter(([, { createdAt }]) => createdAt > loadedAt),
  );
  const batches = new Map(
    [...pending.batches].filter(([, { acceptedAt }]) => acceptedAt > loadedAt),
  );
  const untrackedAt =
    pending.untrackedAt !== null && pending.untrackedAt > loadedAt ? pending.untrackedAt : null;

  const unchanged =
    messages.size === pending.messages.size &&
    batches.size === pending.batches.size &&
    untrackedAt === pending.untrackedAt;
  return unchanged ? pending : { messages, batches, untrackedAt };
}

function withUntracked(pending: PendingNew, createdAt: number): PendingNew {
  if (pending.untrackedAt !== null && pending.untrackedAt >= createdAt) return pending;
  return { ...pending, untrackedAt: createdAt };
}

/**
 * Replace loaded rows with the messages of their events.
 *
 * The stream only reports status changes and a status only moves forward, so
 * an event has news for a row only if it moves the row to a later status.
 * Any other event is one the row already reflects, or one that arrived out of
 * order. Skipping those is also what makes it safe to apply events that
 * waited for a fetch on top of the rows that fetch returned.
 */
export function patchLoaded(
  pages: MessagePages,
  events: ReadonlyMap<string, MessageEvent>,
): MessagePages {
  let anyPageChanged = false;
  const patched = pages.pages.map((page) => {
    let pageChanged = false;
    const data = page.data.map((row) => {
      const event = events.get(row.id);
      if (!event || statusRank(event.status) <= statusRank(row.status)) return row;
      pageChanged = true;
      return event.message;
    });
    if (!pageChanged) return page;
    anyPageChanged = true;
    return { ...page, data };
  });
  return anyPageChanged ? { ...pages, pages: patched } : pages;
}

/** Count (or stop counting) a message after an event about it. A loaded row is never counted. */
export function trackMessage(
  pending: PendingNew,
  event: MessageEvent,
  pages: MessagePages,
  filters: MessageFilters,
  now: number,
): PendingNew {
  const { message } = event;
  // Its batch was counted as a whole. Counting it again would double it.
  if (message.batch_id !== null && pending.batches.has(message.batch_id)) return pending;

  const createdAt = epochMicros(message.created_at);
  const belongs = createdAt > newestLoadedAt(pages) && matchesFilters(filters, message, now);
  if (belongs === pending.messages.has(message.id)) return pending;
  if (belongs && pending.messages.size >= MAX_TRACKED) return withUntracked(pending, createdAt);

  const messages = new Map(pending.messages);
  if (belongs) messages.set(message.id, { batchId: message.batch_id, createdAt });
  else messages.delete(message.id);
  return { ...pending, messages };
}

/** Count a batch once, and drop its messages that were already counted one by one. */
export function trackBatch(
  pending: PendingNew,
  event: BatchEvent,
  filters: MessageFilters,
  now: number,
): PendingNew {
  if (pending.batches.has(event.batch_id) || !batchCouldMatch(filters, event, now)) return pending;

  const acceptedAt = epochMicros(event.occurred_at);
  if (pending.batches.size >= MAX_TRACKED) return withUntracked(pending, acceptedAt);

  const messages = new Map(pending.messages);
  for (const [id, { batchId }] of pending.messages) {
    if (batchId === event.batch_id) messages.delete(id);
  }
  const batches = new Map(pending.batches).set(event.batch_id, { count: event.count, acceptedAt });
  return { ...pending, messages, batches };
}

/** Bring the count of new messages up to date with the events that waited in the buffer. */
export function trackEvents(
  pending: PendingNew,
  events: HeldEvents,
  pages: MessagePages,
  filters: MessageFilters,
  now: number,
): PendingNew {
  let next = forgetLoaded(pending, pages);
  for (const batch of events.batches) next = trackBatch(next, batch, filters, now);
  for (const event of events.messages.values()) {
    next = trackMessage(next, event, pages, filters, now);
  }
  return next;
}
