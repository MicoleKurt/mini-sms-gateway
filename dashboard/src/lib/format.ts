import { format, isSameDay } from "date-fns";

const MICROS_PER_UNIT = 1_000_000;

/**
 * Format an amount of micros without ever rounding it.
 *
 * Whole cents show two decimals ($250.00). SMS prices are fractions of a cent,
 * so anything finer shows four ($249.9960), or six if four would hide digits.
 */
export function formatMoney(micros: number, currency = "USD"): string {
  const absolute = Math.abs(micros);
  const whole = Math.trunc(absolute / MICROS_PER_UNIT);
  const fraction = absolute % MICROS_PER_UNIT;
  const decimals = fraction % 10_000 === 0 ? 2 : fraction % 100 === 0 ? 4 : 6;
  const fractionText = String(fraction).padStart(6, "0").slice(0, decimals);
  const amount = `${whole.toLocaleString("en-US")}.${fractionText}`;
  const text = currency === "USD" ? `$${amount}` : `${amount} ${currency}`;
  return micros < 0 ? `-${text}` : text;
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

export function formatDuration(milliseconds: number): string {
  const ms = Math.max(0, milliseconds);
  if (ms < 1) return ms === 0 ? "0 ms" : "<1 ms";
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(2)} s`;
  const totalSeconds = Math.round(ms / 1_000);
  if (totalSeconds < 3_600) {
    return `${Math.floor(totalSeconds / 60)} min ${totalSeconds % 60} s`;
  }
  return `${Math.floor(totalSeconds / 3_600)} h ${Math.floor((totalSeconds % 3_600) / 60)} min`;
}

/**
 * Microseconds since the epoch. The gateway writes timestamps with microsecond
 * precision and events inside one transaction are often less than a
 * millisecond apart, so `Date` alone would put them in the wrong order.
 */
export function epochMicros(iso: string): number {
  const fraction = /\.(\d+)/.exec(iso)?.[1] ?? "";
  const subMillisecond = Number(fraction.slice(3, 6).padEnd(3, "0"));
  return Date.parse(iso) * 1_000 + subMillisecond;
}

/*
 * The API speaks UTC. The dashboard shows the browser's local time and always
 * says so: either the value carries its UTC offset, or the region that shows
 * bare times of day names the zone once with localZoneLabel().
 */

/** Local date and time with milliseconds and the UTC offset: "2026-11-24 23:04:05.123 +08:00". */
export function formatDateTime(instant: string | number): string {
  return format(new Date(instant), "yyyy-MM-dd HH:mm:ss.SSS xxx");
}

/** Local time of day, for a chart axis. */
export function formatClock(iso: string): string {
  return format(new Date(iso), "HH:mm:ss");
}

/** The browser's UTC offset, for example "UTC+08:00". */
export function localZoneLabel(): string {
  return format(new Date(), "'UTC'xxx");
}

/** Local time of day for a dense table, with the date in front when it is not today. */
export function formatRowTime(iso: string, now: number): string {
  const date = new Date(iso);
  return format(date, isSameDay(date, now) ? "HH:mm:ss" : "MMM d, HH:mm:ss");
}

/**
 * Short age for dense tables: "now", "42s ago", "5m ago", "3h ago". From one
 * day on there is none (null), because the date says more.
 */
export function formatAge(iso: string, now: number): string | null {
  const seconds = Math.floor((now - Date.parse(iso)) / 1_000);
  if (seconds < 5) return "now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return null;
}
