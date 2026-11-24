import type { Price } from "@/lib/api/schemas";

/** The price whose prefix is the longest one the destination starts with. */
export function findPrice(prices: readonly Price[], to: string): Price | null {
  let best: Price | null = null;
  for (const price of prices) {
    if (to.startsWith(price.prefix) && price.prefix.length > (best?.prefix.length ?? 0)) {
      best = price;
    }
  }
  return best;
}
