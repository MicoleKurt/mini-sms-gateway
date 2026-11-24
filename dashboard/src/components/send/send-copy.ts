/**
 * The sentences of the send page, as pure functions of the draft so each
 * state has one tested wording.
 */
import type { Price } from "@/lib/api/schemas";
import { formatAmount } from "@/lib/format";
import type { Encoding, SmsAnalysis } from "@/lib/sms-encoding";
import { MAX_SEGMENTS } from "@/lib/validation";
import type { PriceLookup } from "./price-lookup";

export const ENCODING_NAME: Record<Encoding, string> = { GSM7: "GSM-7", UCS2: "UCS-2" };

/** What the units of an encoding are called. */
export const UNIT_NAME: Record<Encoding, string> = { GSM7: "septets", UCS2: "UTF-16 units" };

export function segmentCount(segments: number): string {
  return segments === 1 ? "1 segment" : `${segments} segments`;
}

/** "0.0120 USD": the one way the page writes an amount, button included. */
export function amountWords(micros: number, currency: string): string {
  return `${formatAmount(micros)} ${currency}`;
}

export type SendHeadlineState =
  | "nothing-typed"
  | "too-long"
  | "no-destination"
  | "invalid-destination"
  | "prices-loading"
  | "prices-failed"
  | "no-price"
  | "over-balance"
  | "priced";

export interface SendHeadlineInput {
  text: string;
  analysis: SmsAnalysis;
  to: string;
  /** The client-side check of the destination: null when it is a valid E.164 number. */
  destinationError: string | null;
  price: PriceLookup;
  tenant: { name: string; balance_micros: number; currency: string } | undefined;
}

/**
 * The one display sentence of the page, by state, in this order:
 *
 *   nothing-typed        Nothing to price yet. Enter a destination and type the text.
 *   too-long             11 segments in GSM-7, over the limit of 10.
 *   no-destination       3 segments in UCS-2. Enter a destination to price them.
 *   invalid-destination  3 segments in UCS-2, but the destination is not an E.164 number.
 *   prices-loading       3 segments in UCS-2. Prices are still loading.
 *   prices-failed        3 segments in UCS-2. Prices could not be loaded.
 *   no-price             No price for +4915112345678, so it can not be sent.
 *   over-balance         3 segments in UCS-2, 0.0120 USD, more than ShopFast has.
 *   priced               3 segments in UCS-2, 0.0120 USD.
 */
export function sendHeadline({
  text,
  analysis,
  to,
  destinationError,
  price,
  tenant,
}: SendHeadlineInput): { state: SendHeadlineState; sentence: string } {
  if (text === "") {
    return {
      state: "nothing-typed",
      sentence:
        to === ""
          ? "Nothing to price yet. Enter a destination and type the text."
          : "Nothing to price yet. Type the text.",
    };
  }

  const shape = `${segmentCount(analysis.segments)} in ${ENCODING_NAME[analysis.encoding]}`;
  const them = analysis.segments === 1 ? "it" : "them";

  if (analysis.segments > MAX_SEGMENTS) {
    return { state: "too-long", sentence: `${shape}, over the limit of ${MAX_SEGMENTS}.` };
  }
  if (to === "") {
    return { state: "no-destination", sentence: `${shape}. Enter a destination to price ${them}.` };
  }
  if (destinationError !== null) {
    return {
      state: "invalid-destination",
      sentence: `${shape}, but the destination is not an E.164 number.`,
    };
  }

  switch (price.state) {
    case "loading":
      return { state: "prices-loading", sentence: `${shape}. Prices are still loading.` };
    case "error":
      return { state: "prices-failed", sentence: `${shape}. Prices could not be loaded.` };
    case "unsupported":
    case "no-destination":
      return { state: "no-price", sentence: `No price for ${to}, so it can not be sent.` };
    case "found":
      break;
  }

  const currency = tenant?.currency ?? "USD";
  const total = price.price.price_per_segment_micros * analysis.segments;
  const cost = `${shape}, ${amountWords(total, currency)}`;
  if (tenant && total > tenant.balance_micros) {
    return { state: "over-balance", sentence: `${cost}, more than ${tenant.name} has.` };
  }
  return { state: "priced", sentence: `${cost}.` };
}

/**
 * The send button: "Send 3 segments · 0.0120 USD" once the cost is known,
 * and otherwise what is missing, so the label never silently drops the price.
 */
export function sendButtonLabel({
  analysis,
  text,
  to,
  price,
  currency,
}: {
  analysis: SmsAnalysis;
  text: string;
  to: string;
  price: PriceLookup;
  currency: string;
}): string {
  if (text === "") return "Send";
  const count = `Send ${segmentCount(analysis.segments)}`;
  switch (price.state) {
    case "found":
      return `${count} · ${amountWords(price.price.price_per_segment_micros * analysis.segments, currency)}`;
    case "unsupported":
      return `${count} · no price for this number`;
    case "no-destination":
      return `${count} · ${to === "" ? "needs a destination" : "not a valid number"}`;
    case "loading":
    case "error":
      return count;
  }
}

/** The line under the From field: what kind of sender this is, and how much room is left. */
export function senderHint(from: string): string {
  if (from === "") return "Up to 11 letters, digits or spaces, or 3 to 15 digits.";
  if (/^\d+$/.test(from)) {
    return `Numeric sender, ${from.length} of 15 digits`;
  }
  return `Alphanumeric sender, ${from.length} of 11 characters`;
}

/** The line under the To field once the number is valid: where it goes and what it costs. */
export function destinationHint(price: PriceLookup, currency: string): string {
  if (price.state === "found") return pricedDestination(price.price, currency);
  if (price.state === "loading") return "Looking up the price…";
  return "E.164, for example +8801711000001";
}

function pricedDestination({ country, prefix, price_per_segment_micros }: Price, currency: string) {
  return `${country}, prefix ${prefix}, ${amountWords(price_per_segment_micros, currency)} per segment`;
}
