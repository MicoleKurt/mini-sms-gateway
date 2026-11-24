import { describe, expect, it } from "vitest";
import type { MessageEvent } from "@/lib/api/schemas";
import type { MessageStatus } from "@/lib/status";
import { EventBuffer } from "./event-buffer";

function eventFor(id: string, status: MessageStatus = "QUEUED"): MessageEvent {
  return {
    id,
    tenant_id: "tenant-a",
    status,
    occurred_at: "2026-11-24T15:09:59Z",
    message: {
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
      status,
      attempts: 0,
      ambiguous_attempts: 0,
      carrier_id: null,
      failure_reason: null,
      created_at: "2026-11-24T15:09:00Z",
      submitted_at: null,
      finalized_at: null,
    },
  };
}

const batch = {
  batch_id: "b1",
  tenant_id: "tenant-a",
  count: 1_000,
  occurred_at: "2026-11-24T15:09:30Z",
};

describe("EventBuffer", () => {
  it("is empty until something is added and again after it is drained", () => {
    const buffer = new EventBuffer();
    expect(buffer.isEmpty).toBe(true);
    buffer.addMessage(eventFor("m1"));
    buffer.addBatch(batch);
    expect(buffer.isEmpty).toBe(false);

    const { events, overflowed } = buffer.drain();
    expect([...events.messages.keys()]).toEqual(["m1"]);
    expect(events.batches).toEqual([batch]);
    expect(overflowed).toBe(false);
    expect(buffer.isEmpty).toBe(true);
  });

  it("holds one event per message: the one that is furthest along", () => {
    const buffer = new EventBuffer();
    buffer.addMessage(eventFor("m1", "QUEUED"));
    buffer.addMessage(eventFor("m1", "DELIVERED"));
    buffer.addMessage(eventFor("m1", "SUBMITTED"));
    expect(buffer.drain().events.messages.get("m1")?.status).toBe("DELIVERED");
  });

  it("reports an overflow instead of growing without limit", () => {
    const buffer = new EventBuffer();
    for (let index = 0; index <= 5_000; index += 1) buffer.addMessage(eventFor(`m${index}`));

    expect(buffer.isEmpty).toBe(false);
    const { events, overflowed } = buffer.drain();
    expect(overflowed).toBe(true);
    expect(events.messages.size).toBe(0);
    expect(buffer.isEmpty).toBe(true);
  });

  it("still takes a later event of a message it already holds when it is full", () => {
    const buffer = new EventBuffer();
    for (let index = 0; index < 5_000; index += 1) buffer.addMessage(eventFor(`m${index}`));
    buffer.addMessage(eventFor("m0", "DELIVERED"));

    const { events, overflowed } = buffer.drain();
    expect(overflowed).toBe(false);
    expect(events.messages.get("m0")?.status).toBe("DELIVERED");
  });
});
