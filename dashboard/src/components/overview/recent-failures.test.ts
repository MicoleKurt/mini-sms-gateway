import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/api/schemas";
import type { MessageStatus } from "@/lib/status";
import { mergeFailures } from "./recent-failures";

function message(id: string, status: MessageStatus, finalizedAt: string | null): Message {
  return {
    id,
    tenant_id: "t1",
    tenant_name: "ShopFast",
    batch_id: null,
    client_ref: null,
    to: "+8801711000001",
    from: "SHOP",
    text: "Your order shipped",
    encoding: "GSM7",
    segments: 1,
    cost_micros: 4_000,
    currency: "USD",
    status,
    attempts: 1,
    ambiguous_attempts: 0,
    carrier_id: null,
    failure_reason: null,
    created_at: "2026-11-24T15:00:00.000000Z",
    submitted_at: null,
    finalized_at: finalizedAt,
  };
}

describe("mergeFailures", () => {
  it("merges the three lists, newest outcome first, up to the limit", () => {
    const failed = [message("f1", "FAILED", "2026-11-24T15:00:03.000000Z")];
    const undelivered = [
      message("u1", "UNDELIVERED", "2026-11-24T15:00:05.000000Z"),
      message("u2", "UNDELIVERED", "2026-11-24T15:00:01.000000Z"),
    ];
    const expired = [message("e1", "EXPIRED", "2026-11-24T15:00:04.000000Z")];
    expect(mergeFailures([failed, undelivered, expired], 3).map((m) => m.id)).toEqual([
      "u1",
      "e1",
      "f1",
    ]);
  });

  it("orders by microseconds, which Date alone would tie", () => {
    const merged = mergeFailures([
      [message("a", "FAILED", "2026-11-24T15:00:00.000100Z")],
      [message("b", "FAILED", "2026-11-24T15:00:00.000200Z")],
    ]);
    expect(merged.map((m) => m.id)).toEqual(["b", "a"]);
  });

  it("keeps the first copy of a message that is in two lists", () => {
    const live = message("x", "UNDELIVERED", "2026-11-24T15:00:09.000000Z");
    const fetched = { ...live, failure_reason: "older copy" };
    expect(mergeFailures([[live], [fetched]])).toEqual([live]);
  });

  it("never lists a delivered message", () => {
    expect(mergeFailures([[message("d", "DELIVERED", "2026-11-24T15:00:09.000000Z")]])).toEqual([]);
  });
});
