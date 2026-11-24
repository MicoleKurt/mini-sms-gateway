import type { UseQueryResult } from "@tanstack/react-query";
import type { Price } from "@/lib/api/schemas";
import { findPrice } from "@/lib/pricing";

export type PriceLookup =
  | { state: "loading" }
  | { state: "error"; retry: () => void }
  /** The destination is not a valid number yet, so there is nothing to look up. */
  | { state: "no-destination" }
  | { state: "unsupported" }
  | { state: "found"; price: Price };

/** Work out what the preview can say about the price of this destination. */
export function lookUpPrice(
  prices: UseQueryResult<Price[]>,
  destination: string,
  destinationIsValid: boolean,
): PriceLookup {
  if (prices.isPending) return { state: "loading" };
  if (prices.isError) return { state: "error", retry: () => void prices.refetch() };
  if (!destinationIsValid) return { state: "no-destination" };
  const price = findPrice(prices.data, destination);
  return price ? { state: "found", price } : { state: "unsupported" };
}
