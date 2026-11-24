import { describe, expect, it } from "vitest";
import { findPrice } from "./pricing";

const prices = [
  { prefix: "+1", country: "United States/Canada", price_per_segment_micros: 7_500 },
  { prefix: "+880", country: "Bangladesh", price_per_segment_micros: 4_000 },
  { prefix: "+44", country: "United Kingdom", price_per_segment_micros: 38_000 },
  { prefix: "+447", country: "United Kingdom mobile", price_per_segment_micros: 41_000 },
];

describe("findPrice", () => {
  it("matches a destination by its prefix", () => {
    expect(findPrice(prices, "+8801711000001")?.country).toBe("Bangladesh");
    expect(findPrice(prices, "+12025550123")?.price_per_segment_micros).toBe(7_500);
  });

  it("prefers the longest matching prefix, whatever the list order", () => {
    expect(findPrice(prices, "+447700900123")?.prefix).toBe("+447");
    expect(findPrice([...prices].reverse(), "+447700900123")?.prefix).toBe("+447");
    expect(findPrice(prices, "+442079460000")?.prefix).toBe("+44");
  });

  it("returns null when no prefix matches", () => {
    expect(findPrice(prices, "+33123456789")).toBeNull();
    expect(findPrice(prices, "")).toBeNull();
    expect(findPrice([], "+8801711000001")).toBeNull();
  });

  it("does not match a number without the plus sign", () => {
    expect(findPrice(prices, "8801711000001")).toBeNull();
  });
});
