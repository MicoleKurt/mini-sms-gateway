import { describe, expect, it } from "vitest";
import { NO_FILTERS, normalizeFilters, type UrlFilters } from "./message-filters";

const url = (changes: Partial<UrlFilters>): UrlFilters => ({
  ...NO_FILTERS,
  range: null,
  ...changes,
});
const from = new Date("2020-01-01T00:00:00Z");
const to = new Date("2020-01-02T00:00:00Z");

describe("normalizeFilters", () => {
  it("is All without a range or bounds", () => {
    expect(normalizeFilters(url({}))).toEqual(NO_FILTERS);
  });

  it("treats bounds without a range as the custom range they describe", () => {
    expect(normalizeFilters(url({ from, to }))).toMatchObject({ range: "custom", from, to });
    expect(normalizeFilters(url({ to }))).toMatchObject({ range: "custom", from: null, to });
  });

  it("drops bounds beside a preset or All, so the fields show the filter in force", () => {
    expect(normalizeFilters(url({ range: "15m", from, to }))).toMatchObject({
      range: "15m",
      from: null,
      to: null,
    });
    expect(normalizeFilters(url({ range: "all", from }))).toMatchObject({
      range: "all",
      from: null,
    });
  });

  it("keeps the other filters as they are", () => {
    expect(normalizeFilters(url({ tenant: "t1", status: "FAILED", q: "+880" }))).toMatchObject({
      tenant: "t1",
      status: "FAILED",
      q: "+880",
    });
  });
});
