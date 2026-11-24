import { describe, expect, it } from "vitest";
import type { Message, MessageEvent } from "@/lib/api/schemas";
import {
  NO_FILTERS,
  createdBounds,
  matchesFilters,
  type MessageFilters,
} from "@/lib/message-filters";
import type { MessageStatus } from "@/lib/status";
import {
  MAX_TRACKED,
  NOTHING_PENDING,
  patchLoaded,
  pendingCount,
  trackBatch,
  trackEvents,
  trackMessage,
  type MessagePages,
  type PendingNew,
} from "./live-list";

const NOW = Date.parse("2026-11-24T15:10:00Z");

function message(id: string, overrides: Partial<Message> = {}): Message {
  return {
    id,
    tenant_id: "tenant-a",
    tenant_name: "Tenant A",
    batch_id: null,
    client_ref: null,
    to: "+8801711000001",
    from: "ACME",
    text: "hello",
    encoding: "GSM7",
    segments: 1,
    cost_micros: 4_000,
    currency: "USD",
    status: "QUEUED",
    attempts: 0,
    ambiguous_attempts: 0,
    carrier_id: null,
    failure_reason: null,
    created_at: "2026-11-24T15:00:00Z",
    submitted_at: null,
    finalized_at: null,
    ...overrides,
  };
}

function eventFor(payload: Message): MessageEvent {
  return {
    id: payload.id,
    tenant_id: payload.tenant_id,
    status: payload.status,
    occurred_at: "2026-11-24T15:09:59Z",
    message: payload,
  };
}

function eventsFor(...payloads: Message[]): Map<string, MessageEvent> {
  return new Map(payloads.map((payload) => [payload.id, eventFor(payload)]));
}

function pagesOf(...pages: Message[][]): MessagePages {
  return {
    pages: pages.map((data) => ({ data, next_cursor: null })),
    pageParams: pages.map(() => null),
  };
}

const loaded = pagesOf(
  [
    message("m3", { created_at: "2026-11-24T15:03:00Z" }),
    message("m2", { created_at: "2026-11-24T15:02:00Z" }),
  ],
  [message("m1", { created_at: "2026-11-24T15:01:00Z" })],
);

describe("patchLoaded", () => {
  it("replaces the row on whichever page holds it and keeps the other rows", () => {
    const next = patchLoaded(
      loaded,
      eventsFor(message("m1", { status: "DELIVERED", attempts: 1 })),
    );
    expect(next.pages[1]?.data[0]).toMatchObject({ id: "m1", status: "DELIVERED", attempts: 1 });
    expect(next.pages[0]).toBe(loaded.pages[0]);
  });

  it("patches every row that has an event in one pass", () => {
    const next = patchLoaded(
      loaded,
      eventsFor(message("m3", { status: "SUBMITTED" }), message("m1", { status: "FAILED" })),
    );
    expect(next.pages.flatMap((page) => page.data.map((row) => row.status))).toEqual([
      "SUBMITTED",
      "QUEUED",
      "FAILED",
    ]);
  });

  it("ignores an event that would move the status backwards", () => {
    const delivered = pagesOf([message("m1", { status: "DELIVERED" })]);
    expect(patchLoaded(delivered, eventsFor(message("m1", { status: "SUBMITTED" })))).toBe(
      delivered,
    );
  });

  it("ignores an event for the status the row already has", () => {
    // The row came from a fetch that ran after the event: it can be newer than the event.
    const retried = pagesOf([message("m1", { status: "SUBMITTED", attempts: 2 })]);
    expect(
      patchLoaded(retried, eventsFor(message("m1", { status: "SUBMITTED", attempts: 1 }))),
    ).toBe(retried);
  });

  it("does nothing for a message that is not loaded", () => {
    expect(patchLoaded(loaded, eventsFor(message("unknown", { status: "DELIVERED" })))).toBe(
      loaded,
    );
  });
});

describe("trackMessage", () => {
  const newer = message("m9", { created_at: "2026-11-24T15:09:00Z" });

  it("counts an unloaded message that is newer than the first row", () => {
    const pending = trackMessage(NOTHING_PENDING, eventFor(newer), loaded, NO_FILTERS, NOW);
    expect(pendingCount(pending, loaded)).toEqual({ count: 1, orMore: false });
  });

  it("counts a message once, however many events it has", () => {
    const first = trackMessage(NOTHING_PENDING, eventFor(newer), loaded, NO_FILTERS, NOW);
    const second = trackMessage(
      first,
      eventFor({ ...newer, status: "SUBMITTED" }),
      loaded,
      NO_FILTERS,
      NOW,
    );
    expect(second).toBe(first);
  });

  it("does not count an older message that is simply further down the list", () => {
    const older = message("m0", { created_at: "2026-11-24T14:00:00Z" });
    expect(trackMessage(NOTHING_PENDING, eventFor(older), loaded, NO_FILTERS, NOW)).toBe(
      NOTHING_PENDING,
    );
  });

  it("does not count a message the filters would not return", () => {
    const filters: MessageFilters = { ...NO_FILTERS, tenant: "tenant-b" };
    expect(trackMessage(NOTHING_PENDING, eventFor(newer), loaded, filters, NOW)).toBe(
      NOTHING_PENDING,
    );
  });

  it("stops counting a message when it leaves the filtered status", () => {
    const filters: MessageFilters = { ...NO_FILTERS, status: "QUEUED" };
    const counted = trackMessage(NOTHING_PENDING, eventFor(newer), loaded, filters, NOW);
    const moved = trackMessage(
      counted,
      eventFor({ ...newer, status: "SUBMITTED" }),
      loaded,
      filters,
      NOW,
    );
    expect(pendingCount(counted, loaded).count).toBe(1);
    expect(pendingCount(moved, loaded).count).toBe(0);
  });

  it("counts any matching message when nothing is loaded", () => {
    const pending = trackMessage(NOTHING_PENDING, eventFor(newer), pagesOf([]), NO_FILTERS, NOW);
    expect(pendingCount(pending, pagesOf([])).count).toBe(1);
  });

  it("stops counting a message once a refetch has loaded it", () => {
    const pending = trackMessage(NOTHING_PENDING, eventFor(newer), loaded, NO_FILTERS, NOW);
    const refetched = pagesOf([newer, ...(loaded.pages[0]?.data ?? [])]);
    expect(pendingCount(pending, refetched).count).toBe(0);
  });

  it("does not count a loaded row, whatever its event says", () => {
    const row = message("m3", { created_at: "2026-11-24T15:03:00Z", status: "DELIVERED" });
    expect(trackMessage(NOTHING_PENDING, eventFor(row), loaded, NO_FILTERS, NOW)).toBe(
      NOTHING_PENDING,
    );
  });
});

describe("the tracking limit", () => {
  function trackMany(count: number): PendingNew {
    let pending = NOTHING_PENDING;
    for (let index = 0; index < count; index += 1) {
      const created_at = new Date(Date.parse("2026-11-24T15:05:00Z") + index).toISOString();
      pending = trackMessage(
        pending,
        eventFor(message(`new-${index}`, { created_at })),
        loaded,
        NO_FILTERS,
        NOW,
      );
    }
    return pending;
  }

  it("stops tracking messages one by one and says that there are more", () => {
    const pending = trackMany(MAX_TRACKED + 5);
    expect(pending.messages.size).toBe(MAX_TRACKED);
    expect(pendingCount(pending, loaded)).toEqual({ count: MAX_TRACKED, orMore: true });
  });

  it("is exact up to the limit", () => {
    expect(pendingCount(trackMany(MAX_TRACKED), loaded)).toEqual({
      count: MAX_TRACKED,
      orMore: false,
    });
  });

  it("starts again once a refetch has loaded what was pending", () => {
    const full = trackMany(MAX_TRACKED + 5);
    const newest = message("new-last", { created_at: "2026-11-24T15:06:00Z" });
    const later = message("m10", { created_at: "2026-11-24T15:07:00Z" });

    const pending = trackEvents(
      full,
      { messages: eventsFor(later), batches: [] },
      pagesOf([newest]),
      NO_FILTERS,
      NOW,
    );
    expect(pending.messages.size).toBe(1);
    expect(pendingCount(pending, pagesOf([newest]))).toEqual({ count: 1, orMore: false });
  });
});

describe("trackEvents", () => {
  it("counts a batch before its messages, so they are not counted twice", () => {
    const inBatch = message("m9", { batch_id: "b1", created_at: "2026-11-24T15:09:30Z" });
    const batch = {
      batch_id: "b1",
      tenant_id: "tenant-a",
      count: 1_000,
      occurred_at: "2026-11-24T15:09:30Z",
    };
    const pending = trackEvents(
      NOTHING_PENDING,
      { messages: eventsFor(inBatch), batches: [batch] },
      loaded,
      NO_FILTERS,
      NOW,
    );
    expect(pendingCount(pending, loaded).count).toBe(1_000);
  });

  it("returns the same record when the events change nothing", () => {
    const older = message("m0", { created_at: "2026-11-24T14:00:00Z" });
    expect(
      trackEvents(
        NOTHING_PENDING,
        { messages: eventsFor(older), batches: [] },
        loaded,
        NO_FILTERS,
        NOW,
      ),
    ).toBe(NOTHING_PENDING);
  });
});

describe("trackBatch", () => {
  const batch = {
    batch_id: "b1",
    tenant_id: "tenant-a",
    count: 1_000,
    occurred_at: "2026-11-24T15:09:30Z",
  };
  const inBatch = message("m9", { batch_id: "b1", created_at: "2026-11-24T15:09:30Z" });

  it("adds the batch size once", () => {
    const once = trackBatch(NOTHING_PENDING, batch, NO_FILTERS, NOW);
    expect(pendingCount(once, loaded).count).toBe(1_000);
    expect(trackBatch(once, batch, NO_FILTERS, NOW)).toBe(once);
  });

  it("does not count the batch's messages a second time", () => {
    const withBatch = trackBatch(NOTHING_PENDING, batch, NO_FILTERS, NOW);
    expect(trackMessage(withBatch, eventFor(inBatch), loaded, NO_FILTERS, NOW)).toBe(withBatch);
  });

  it("drops messages of the batch that were counted before the batch event", () => {
    const early = trackMessage(NOTHING_PENDING, eventFor(inBatch), loaded, NO_FILTERS, NOW);
    expect(pendingCount(trackBatch(early, batch, NO_FILTERS, NOW), loaded).count).toBe(1_000);
  });

  it.each<[string, Partial<MessageFilters>]>([
    ["another tenant", { tenant: "tenant-b" }],
    ["a later status", { status: "DELIVERED" }],
    ["a search", { q: "+8801711000001" }],
    ["a custom range that has ended", { range: "custom", to: new Date("2026-11-24T15:00:00Z") }],
  ])("ignores a batch when the filter is %s", (_name, override) => {
    expect(trackBatch(NOTHING_PENDING, batch, { ...NO_FILTERS, ...override }, NOW)).toBe(
      NOTHING_PENDING,
    );
  });
});

describe("message filters", () => {
  it("resolves a preset against the current time", () => {
    expect(createdBounds({ ...NO_FILTERS, range: "15m" }, NOW)).toEqual({
      from: "2026-11-24T14:55:00.000Z",
      to: null,
    });
    expect(createdBounds(NO_FILTERS, NOW)).toEqual({ from: null, to: null });
  });

  it("uses from and to only for a custom range", () => {
    const from = new Date("2026-11-24T10:00:00Z");
    expect(createdBounds({ ...NO_FILTERS, range: "custom", from }, NOW)).toEqual({
      from: "2026-11-24T10:00:00.000Z",
      to: null,
    });
    expect(createdBounds({ ...NO_FILTERS, range: "1h", from }, NOW).from).toBe(
      "2026-11-24T14:10:00.000Z",
    );
  });

  it.each<[string, Partial<MessageFilters>, boolean]>([
    ["no filters", {}, true],
    ["the same tenant", { tenant: "tenant-a" }, true],
    ["another tenant", { tenant: "tenant-b" }, false],
    ["the same status", { status: "QUEUED" satisfies MessageStatus }, true],
    ["another status", { status: "FAILED" satisfies MessageStatus }, false],
    ["a search for the ID", { q: "m1" }, true],
    ["a search for the destination", { q: "+8801711000001" }, true],
    ["a search for part of the destination", { q: "+88017" }, false],
    ["a range that contains it", { range: "15m" }, true],
    [
      "a range that ended before it",
      { range: "custom", to: new Date("2026-11-24T14:00:00Z") },
      false,
    ],
  ])("matches a message against %s", (_name, override, expected) => {
    const subject = message("m1", { created_at: "2026-11-24T15:00:00Z" });
    expect(matchesFilters({ ...NO_FILTERS, ...override }, subject, NOW)).toBe(expected);
  });
});
