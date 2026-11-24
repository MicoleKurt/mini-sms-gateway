import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyze, charactersForcingUcs2, splitSegments, type Encoding } from "./sms-encoding";

interface Vector {
  name: string;
  text: string;
  encoding: Encoding;
  units: number;
  segments: number;
}

// The same file drives the Python tests of the gateway.
const vectors: Vector[] = JSON.parse(
  readFileSync(new URL("../../../shared/encoding-vectors.json", import.meta.url), "utf8"),
);

describe("analyze, against the shared vectors", () => {
  it("has vectors to check", () => {
    expect(vectors.length).toBeGreaterThan(0);
  });

  it.each(vectors)("$name", ({ text, encoding, units, segments }) => {
    const result = analyze(text);
    expect(result.encoding).toBe(encoding);
    expect(result.units).toBe(units);
    expect(result.segments).toBe(segments);
  });
});

describe("splitSegments", () => {
  it.each(vectors)(
    "matches the count, the units and the text: $name",
    ({ text, units, segments }) => {
      const parts = splitSegments(text);
      expect(parts).toHaveLength(segments);
      expect(parts.map((part) => part.text).join("")).toBe(text);
      expect(parts.reduce((total, part) => total + part.units, 0)).toBe(units);
    },
  );

  it("moves an escape pair that does not fit to the next segment", () => {
    const [first, second] = splitSegments("a".repeat(152) + "€" + "a".repeat(10));
    expect(first).toEqual({ text: "a".repeat(152), units: 152 });
    expect(second).toEqual({ text: "€" + "a".repeat(10), units: 12 });
  });

  it("never cuts a surrogate pair in half", () => {
    const [first, second] = splitSegments("x".repeat(66) + "😀" + "x".repeat(10));
    expect(first).toEqual({ text: "x".repeat(66), units: 66 });
    expect(second).toEqual({ text: "😀" + "x".repeat(10), units: 12 });
  });

  it("counts a segment in the encoding of the whole message", () => {
    // The second segment is plain ASCII, but the emoji makes the message UCS-2.
    const [, second] = splitSegments("😀" + "a".repeat(65) + "{".repeat(5));
    expect(second).toEqual({ text: "{".repeat(5), units: 5 });
  });
});

describe("charactersForcingUcs2", () => {
  it("is empty for GSM-7 text", () => {
    expect(charactersForcingUcs2("Hello {world} €")).toEqual([]);
  });

  it("lists each character once, in order of first use, with its code point", () => {
    expect(charactersForcingUcs2("Hi 😀 there ‘you’ 😀")).toEqual([
      { char: "😀", codePoint: "U+1F600" },
      { char: "‘", codePoint: "U+2018" },
      { char: "’", codePoint: "U+2019" },
    ]);
  });

  it("pads short code points to four digits", () => {
    expect(charactersForcingUcs2("a\tb")).toEqual([{ char: "\t", codePoint: "U+0009" }]);
  });
});
