import { describe, expect, it } from "vitest";
import {
  epochMicros,
  formatAmount,
  formatDateTime,
  formatDuration,
  sharedIdPrefix,
  timeOfDayParts,
} from "./format";

describe("formatDuration", () => {
  it.each([
    [0, "0 ms"],
    [0.4, "<1 ms"],
    [182, "182 ms"],
    [1_820, "1.82 s"],
    [125_000, "2 min 5 s"],
    [3_720_000, "1 h 2 min"],
  ])("formats %d ms as %s", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe("epochMicros", () => {
  it("keeps the microseconds that Date drops", () => {
    const earlier = epochMicros("2026-11-24T15:04:05.123456Z");
    const later = epochMicros("2026-11-24T15:04:05.123999Z");
    expect(later - earlier).toBe(543);
  });

  it("accepts timestamps with fewer fractional digits", () => {
    expect(epochMicros("2026-11-24T15:04:05Z")).toBe(Date.parse("2026-11-24T15:04:05Z") * 1_000);
    expect(epochMicros("2026-11-24T15:04:05.5Z")).toBe(
      Date.parse("2026-11-24T15:04:05.500Z") * 1_000,
    );
  });
});

describe("formatDateTime", () => {
  it("writes a full timestamp in UTC and says so, whatever the zone it came in", () => {
    expect(formatDateTime("2026-11-25T00:04:05.123+08:00")).toBe("2026-11-24 16:04:05 UTC");
    expect(formatDateTime(Date.parse("2026-11-24T16:04:05Z"))).toBe("2026-11-24 16:04:05 UTC");
  });
});

describe("formatAmount", () => {
  it.each([
    [0, "0.0000"],
    [239_900_000, "239.9000"],
    [1_160_780_000, "1,160.7800"],
    [4_000, "0.0040"],
    [123, "0.000123"],
    [1_000_001, "1.000001"],
    [-12_000, "−0.0120"],
  ])("formats %i micros as %s", (micros, expected) => {
    expect(formatAmount(micros)).toBe(expected);
  });

  it("takes a smaller minimum for whole amounts", () => {
    expect(formatAmount(250_000_000, 0)).toBe("250");
    expect(formatAmount(250_500_000, 2)).toBe("250.50");
  });
});

describe("timeOfDayParts", () => {
  it("splits a UTC time into clock and milliseconds", () => {
    expect(timeOfDayParts("2026-11-24T16:13:35.412345+00:00")).toEqual({
      clock: "16:13:35",
      millis: ".412",
    });
  });

  it("converts an offset to UTC", () => {
    expect(timeOfDayParts("2026-11-25T00:13:35.004+08:00")).toEqual({
      clock: "16:13:35",
      millis: ".004",
    });
  });
});

describe("sharedIdPrefix", () => {
  it("is the groups every ID starts with", () => {
    const ids = [
      "01a20e9a-071e-7f28-8af7-ea86ed07bf4e",
      "01a20e9a-071f-7cb5-acb5-4c78ffaea071",
      "01a20e9a-06af-7d07-9ebf-d04faa09e427",
    ];
    expect(sharedIdPrefix(ids)).toBe("01a20e9a-".length);
  });

  it("stops at the end of a whole group, not inside one", () => {
    expect(sharedIdPrefix(["01a20e9a-071e-7f28", "01a20e9a-071f-7cb5"])).toBe(9);
    expect(sharedIdPrefix(["01a20e9a-071e-7f28", "01a20e9b-071e-7f28"])).toBe(0);
  });

  it("shares nothing with fewer than two IDs, or when they are all the same", () => {
    expect(sharedIdPrefix([])).toBe(0);
    expect(sharedIdPrefix(["01a20e9a-071e-7f28"])).toBe(0);
    expect(sharedIdPrefix(["01a20e9a-071e", "01a20e9a-071e"])).toBe(0);
  });
});
