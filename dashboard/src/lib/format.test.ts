import { describe, expect, it } from "vitest";
import {
  epochMicros,
  formatAge,
  formatDateTime,
  formatDuration,
  formatMoney,
  formatRowTime,
} from "./format";

describe("formatMoney", () => {
  it.each([
    [0, "$0.00"],
    [250_000_000, "$250.00"],
    [1_000_000_000, "$1,000.00"],
    [249_996_000, "$249.9960"],
    [4_000, "$0.0040"],
    [3_500, "$0.0035"],
    [38_000, "$0.0380"],
    [10_000, "$0.01"],
    [1_234_567_890_000, "$1,234,567.89"],
  ])("formats %i micros as %s", (micros, expected) => {
    expect(formatMoney(micros)).toBe(expected);
  });

  it("shows six decimals instead of rounding sub-0.0001 amounts", () => {
    expect(formatMoney(123)).toBe("$0.000123");
    expect(formatMoney(1_000_001)).toBe("$1.000001");
  });

  it("puts the sign before the currency symbol", () => {
    expect(formatMoney(-4_000)).toBe("-$0.0040");
    expect(formatMoney(-12_500_000)).toBe("-$12.50");
  });

  it("writes other currencies as a code after the amount", () => {
    expect(formatMoney(4_000, "EUR")).toBe("0.0040 EUR");
  });
});

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

describe("formatAge", () => {
  const now = Date.parse("2026-11-24T15:00:00Z");

  it.each([
    ["2026-11-24T14:59:58Z", "now"],
    ["2026-11-24T14:59:18Z", "42s ago"],
    ["2026-11-24T14:55:00Z", "5m ago"],
    ["2026-11-24T12:00:00Z", "3h ago"],
  ])("formats %s as %s", (iso, expected) => {
    expect(formatAge(iso, now)).toBe(expected);
  });

  it("has no age from one day on", () => {
    expect(formatAge("2026-11-23T15:00:00Z", now)).toBeNull();
  });
});

// These run in whatever zone the machine is in, so they build their
// timestamps from local date parts instead of assuming one.
describe("local timestamps", () => {
  const local = new Date(2026, 10, 24, 23, 4, 5, 123);

  it("writes the UTC offset after a full timestamp", () => {
    expect(formatDateTime(local.toISOString())).toMatch(
      /^2026-11-24 23:04:05\.123 [+-]\d{2}:\d{2}$/,
    );
    expect(formatDateTime(local.getTime())).toBe(formatDateTime(local.toISOString()));
  });

  it("shows only the time of day for a row from today", () => {
    const laterThatDay = new Date(2026, 10, 24, 23, 30).getTime();
    expect(formatRowTime(local.toISOString(), laterThatDay)).toBe("23:04:05");
  });

  it("puts the date in front for a row from another day", () => {
    const nextDay = new Date(2026, 10, 25, 0, 10).getTime();
    expect(formatRowTime(local.toISOString(), nextDay)).toBe("Nov 24, 23:04:05");
  });
});
