import { describe, expect, it } from "vitest";
import { formatUtcInput, parseUtcInput } from "./utc-input";

describe("formatUtcInput", () => {
  it("writes the UTC minute, not the local one", () => {
    expect(formatUtcInput(new Date("2026-11-24T16:13:42.512Z"))).toBe("2026-11-24 16:13");
  });

  it("is empty for no bound", () => {
    expect(formatUtcInput(null)).toBe("");
  });
});

describe("parseUtcInput", () => {
  it("reads a minute, a second or a whole day as UTC", () => {
    expect(parseUtcInput("2026-11-24 16:13")).toEqual(new Date("2026-11-24T16:13:00Z"));
    expect(parseUtcInput(" 2026-11-24T16:13:05 ")).toEqual(new Date("2026-11-24T16:13:05Z"));
    expect(parseUtcInput("2026-11-24")).toEqual(new Date("2026-11-24T00:00:00Z"));
  });

  it("reads an empty field as no bound", () => {
    expect(parseUtcInput("   ")).toBeNull();
  });

  it("refuses text and times that do not exist", () => {
    expect(parseUtcInput("yesterday")).toBe("invalid");
    expect(parseUtcInput("2026-11-31 10:00")).toBe("invalid");
    expect(parseUtcInput("2026-11-24 24:00")).toBe("invalid");
    expect(parseUtcInput("2026-11-24 10:00:60")).toBe("invalid");
  });

  it("gives back what formatUtcInput wrote", () => {
    const date = new Date("2026-02-28T23:59:00Z");
    expect(parseUtcInput(formatUtcInput(date))).toEqual(date);
  });
});
