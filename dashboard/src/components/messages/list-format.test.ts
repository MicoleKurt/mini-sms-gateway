import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/api/schemas";
import {
  arrivedSince,
  groupByUtcDay,
  secondsToFinal,
  splitListId,
  utcDayLabel,
} from "./list-format";

function message(id: string, createdAt: string, finalizedAt: string | null = null): Message {
  return {
    id,
    tenant_id: "t1",
    tenant_name: "Acme Bank",
    batch_id: null,
    client_ref: null,
    to: "+971506701448",
    from: "ACME",
    text: "Your Acme Bank code is 619835",
    encoding: "GSM7",
    segments: 1,
    cost_micros: 21_000,
    currency: "USD",
    status: finalizedAt ? "DELIVERED" : "QUEUED",
    attempts: 1,
    ambiguous_attempts: 0,
    carrier_id: null,
    failure_reason: null,
    created_at: createdAt,
    submitted_at: null,
    finalized_at: finalizedAt,
  };
}

describe("utcDayLabel", () => {
  it("names the UTC day, whatever the local zone", () => {
    expect(utcDayLabel("2026-11-24T23:59:59.999Z")).toBe("Tuesday 24 Nov 2026");
    expect(utcDayLabel("2026-11-25T00:00:00Z")).toBe("Wednesday 25 Nov 2026");
  });
});

describe("groupByUtcDay", () => {
  it("puts consecutive messages of one UTC day under one group, keeping their order", () => {
    const groups = groupByUtcDay([
      message("c", "2026-11-25T00:00:01Z"),
      message("b", "2026-11-24T23:59:59Z"),
      message("a", "2026-11-24T08:00:00Z"),
    ]);
    expect(groups.map(({ day, messages }) => [day, messages.map(({ id }) => id)])).toEqual([
      ["2026-11-25", ["c"]],
      ["2026-11-24", ["b", "a"]],
    ]);
    expect(groups[1]?.label).toBe("Tuesday 24 Nov 2026");
  });

  it("has no groups for no messages", () => {
    expect(groupByUtcDay([])).toEqual([]);
  });
});

describe("splitListId", () => {
  it("shows the first three groups, which tell apart a batch accepted in one millisecond", () => {
    expect(splitListId("01a20e92-15d1-7a3c-9f0e-1b2c3d4e5f60")).toEqual({
      shown: "01a20e92-15d1-7a3c",
      rest: "-9f0e-1b2c3d4e5f60",
    });
  });

  it("shows an ID that is not a UUID whole", () => {
    expect(splitListId("m1")).toEqual({ shown: "m1", rest: "" });
  });
});

describe("secondsToFinal", () => {
  it("is the time from accept to the final status, to two decimals", () => {
    const final = message("m", "2026-11-24T15:57:53.070100Z", "2026-11-24T15:58:02.244420Z");
    expect(secondsToFinal(final)).toBe("9.17");
  });

  it("is null while the message is not final", () => {
    expect(secondsToFinal(message("m", "2026-11-24T15:57:53Z"))).toBeNull();
  });
});

describe("arrivedSince", () => {
  const rows = [
    message("new", "2026-11-24T16:00:00.000002Z"),
    message("old", "2026-11-24T16:00:00.000001Z"),
  ];

  it("is the rows newer than the newest row shown before, to the microsecond", () => {
    expect([...arrivedSince(rows, "2026-11-24T16:00:00.000001Z")]).toEqual(["new"]);
  });

  it("is nothing for a list that was not shown yet", () => {
    expect(arrivedSince(rows, null).size).toBe(0);
  });
});
