import { describe, expect, it } from "vitest";
import type { Price } from "@/lib/api/schemas";
import { analyze } from "@/lib/sms-encoding";
import { validateDestination } from "@/lib/validation";
import type { PriceLookup } from "./price-lookup";
import {
  destinationHint,
  sendButtonLabel,
  sendHeadline,
  senderHint,
  type SendHeadlineInput,
} from "./send-copy";

const BANGLADESH: Price = { prefix: "+880", country: "Bangladesh", price_per_segment_micros: 4000 };
const FOUND: PriceLookup = { state: "found", price: BANGLADESH };
const SHOPFAST = { name: "ShopFast", balance_micros: 920_880_000, currency: "USD" };
const PARCEL =
  "Hi! Your ShopFast order #48213 is out for delivery today between 2 and 4 pm. " +
  "Track it here: shopfast.example/t/48213 📦 Thanks for shopping with us!";

function headline(overrides: Partial<SendHeadlineInput> & { text?: string; to?: string }) {
  const text = overrides.text ?? PARCEL;
  const to = overrides.to ?? "+8801711000001";
  return sendHeadline({
    text,
    analysis: analyze(text),
    to,
    destinationError: validateDestination(to),
    price: FOUND,
    tenant: SHOPFAST,
    ...overrides,
  });
}

describe("sendHeadline", () => {
  it("states segments, encoding and cost when everything is known", () => {
    expect(headline({})).toEqual({ state: "priced", sentence: "3 segments in UCS-2, 0.0120 USD." });
  });

  it("uses the singular for one GSM-7 segment", () => {
    expect(headline({ text: "Your code is 4821" }).sentence).toBe(
      "1 segment in GSM-7, 0.0040 USD.",
    );
  });

  it("says what is missing before there is anything to price", () => {
    expect(headline({ text: "", to: "" })).toEqual({
      state: "nothing-typed",
      sentence: "Nothing to price yet. Enter a destination and type the text.",
    });
    expect(headline({ text: "", to: "nonsense" }).sentence).toBe(
      "Nothing to price yet. Type the text.",
    );
  });

  it("names the segment limit", () => {
    const result = headline({ text: "a".repeat(153 * 10 + 1) });
    expect(result).toEqual({
      state: "too-long",
      sentence: "11 segments in GSM-7, over the limit of 10.",
    });
  });

  it("asks for a destination", () => {
    expect(headline({ to: "", price: { state: "no-destination" } }).sentence).toBe(
      "3 segments in UCS-2. Enter a destination to price them.",
    );
    expect(headline({ text: "Hi", to: "", price: { state: "no-destination" } }).sentence).toBe(
      "1 segment in GSM-7. Enter a destination to price it.",
    );
  });

  it("says an invalid destination is not E.164", () => {
    expect(headline({ to: "+88017", price: { state: "no-destination" } })).toEqual({
      state: "invalid-destination",
      sentence: "3 segments in UCS-2, but the destination is not an E.164 number.",
    });
  });

  it("names the number there is no price for", () => {
    expect(headline({ to: "+4915112345678", price: { state: "unsupported" } })).toEqual({
      state: "no-price",
      sentence: "No price for +4915112345678, so it can not be sent.",
    });
  });

  it("says when prices are loading or failed", () => {
    expect(headline({ price: { state: "loading" } }).state).toBe("prices-loading");
    expect(headline({ price: { state: "error", retry: () => {} } }).sentence).toBe(
      "3 segments in UCS-2. Prices could not be loaded.",
    );
  });

  it("says when the cost is more than the balance", () => {
    expect(headline({ tenant: { ...SHOPFAST, balance_micros: 10_000 } })).toEqual({
      state: "over-balance",
      sentence: "3 segments in UCS-2, 0.0120 USD, more than ShopFast has.",
    });
  });
});

describe("sendButtonLabel", () => {
  const label = (text: string, price: PriceLookup, to = "+8801711000001", currency = "USD") =>
    sendButtonLabel({ analysis: analyze(text), text, to, price, currency });

  it("carries the segments and the cost, written as everywhere else on the page", () => {
    expect(label(PARCEL, FOUND)).toBe("Send 3 segments · 0.0120 USD");
    expect(label("Hi", FOUND, "+8801711000001", "EUR")).toBe("Send 1 segment · 0.0040 EUR");
  });

  it("is a bare Send before any text", () => {
    expect(label("", FOUND)).toBe("Send");
  });

  it("says why there is no price instead of dropping it", () => {
    expect(label("Hi", { state: "unsupported" }, "+4915112345678")).toBe(
      "Send 1 segment · no price for this number",
    );
    expect(label("Hi", { state: "no-destination" }, "+88017")).toBe(
      "Send 1 segment · not a valid number",
    );
    expect(label("Hi", { state: "no-destination" }, "")).toBe(
      "Send 1 segment · needs a destination",
    );
  });

  it("leaves the price out while prices load", () => {
    expect(label("Hi", { state: "loading" })).toBe("Send 1 segment");
  });
});

describe("field hints", () => {
  it("describes the sender", () => {
    expect(senderHint("SHOPFAST")).toBe("Alphanumeric sender, 8 of 11 characters");
    expect(senderHint("12345")).toBe("Numeric sender, 5 of 15 digits");
    expect(senderHint("")).toBe("Up to 11 letters, digits or spaces, or 3 to 15 digits.");
  });

  it("describes a priced destination", () => {
    expect(destinationHint(FOUND, "USD")).toBe("Bangladesh, prefix +880, 0.0040 USD per segment");
    expect(destinationHint({ state: "no-destination" }, "USD")).toBe(
      "E.164, for example +8801711000001",
    );
  });
});
