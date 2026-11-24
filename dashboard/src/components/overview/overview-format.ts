import { formatCount } from "@/lib/format";

/** A no-break space keeps a figure and its unit on one line. */
const NBSP = " ";

/** How long the oldest message has waited: "0.4 s", "81.4 s", "2 min 21 s", "1 h 4 min". */
export function formatWait(milliseconds: number): string {
  const seconds = Math.max(0, milliseconds) / 1_000;
  if (seconds < 59.95) return `${seconds.toFixed(1)}${NBSP}s`;
  return formatLongSpan(Math.round(seconds));
}

/** A rough span in whole seconds for an estimate: "41 s", "2 min 21 s". */
export function formatAbout(seconds: number): string {
  const whole = Math.max(1, Math.ceil(seconds));
  if (whole < 60) return `${whole}${NBSP}s`;
  return formatLongSpan(whole);
}

function formatLongSpan(totalSeconds: number): string {
  if (totalSeconds < 3_600) {
    return `${Math.floor(totalSeconds / 60)}${NBSP}min ${totalSeconds % 60}${NBSP}s`;
  }
  const hours = Math.floor(totalSeconds / 3_600);
  return `${hours}${NBSP}h ${Math.floor((totalSeconds % 3_600) / 60)}${NBSP}min`;
}

/** A rate per second to one decimal, so its width only changes with its tens: "46.2". */
export function formatRate(perSecond: number): string {
  return perSecond.toFixed(1);
}

/** A configured figure such as a limit: "50", or "46.5" when it has a fraction. */
export function formatSetting(value: number): string {
  return Number.isInteger(value) ? formatCount(value) : value.toFixed(1);
}

/** A share of a total to one decimal: "89.1". Zero when there is no total. */
export function formatShare(part: number, total: number): string {
  return total === 0 ? "0.0" : ((part / total) * 100).toFixed(1);
}

/** A signed change with a true minus sign: "+212", "−1,310", "0". */
export function formatChange(change: number): string {
  if (change === 0) return "0";
  return `${change > 0 ? "+" : "−"}${formatCount(Math.abs(change))}`;
}

/** "Acme Bank", "Acme Bank and ShopFast", "A, B and C". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
