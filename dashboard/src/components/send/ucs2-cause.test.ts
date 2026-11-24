import { describe, expect, it } from "vitest";
import { explainUcs2, forcesUcs2 } from "./ucs2-cause";

const PARCEL =
  "Hi! Your ShopFast order #48213 is out for delivery today between 2 and 4 pm. " +
  "Track it here: shopfast.example/t/48213 📦 Thanks for shopping with us!";

describe("explainUcs2", () => {
  it("is null for a GSM-7 text, extension characters included", () => {
    expect(explainUcs2("Price: 5€ [incl. tax]")).toBeNull();
  });

  it("names the character, its code point, position and segment", () => {
    const explanation = explainUcs2(PARCEL)!;
    expect(explanation.causes).toEqual([
      { char: "📦", codePoint: "U+1F4E6", position: 118, segment: 2, uses: 1 },
    ]);
  });

  it("says what the text would be without it", () => {
    const { without } = explainUcs2(PARCEL)!;
    expect(without).toMatchObject({ encoding: "GSM7", segments: 1 });
  });

  it("counts every use but names each character once, in order of first use", () => {
    const { causes } = explainUcs2("ś a ś b ł")!;
    expect(causes.map(({ char, position, uses }) => [char, position, uses])).toEqual([
      ["ś", 1, 2],
      ["ł", 9, 1],
    ]);
  });

  it("does not compare with the text left over when most of it is not GSM-7", () => {
    const explanation = explainUcs2("Привет")!;
    expect(explanation.causes).toHaveLength(6);
    expect(explanation.without).toBeNull();
  });
});

describe("forcesUcs2", () => {
  it("is false for basic and extension GSM-7 characters", () => {
    expect(forcesUcs2("a")).toBe(false);
    expect(forcesUcs2("€")).toBe(false);
    expect(forcesUcs2("😀")).toBe(true);
  });
});
