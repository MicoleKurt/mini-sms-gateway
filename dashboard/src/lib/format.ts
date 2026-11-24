const MICROS_PER_UNIT = 1_000_000;

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
 * The API speaks UTC and so does the console: every time on screen is UTC,
 * and the column head, the sentence or the value itself says so.
 */

/** A full date and time in UTC, to the second: "2026-11-24 15:04:05 UTC". */
export function formatDateTime(instant: string | number): string {
  return `${new Date(instant).toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/**
 * An amount for a column of amounts: no currency sign, at least `minDecimals`
 * decimals so a column lines up on the point, more only when they are not
 * zero ("1,160.7800", "0.000123"). Negative amounts take a true minus sign.
 */
export function formatAmount(micros: number, minDecimals = 4): string {
  const absolute = Math.abs(micros);
  const whole = Math.trunc(absolute / MICROS_PER_UNIT);
  const digits = String(absolute % MICROS_PER_UNIT).padStart(6, "0");
  const needed = digits.replace(/0+$/, "").length;
  const fraction = digits.slice(0, Math.max(minDecimals, needed));
  const amount = fraction
    ? `${whole.toLocaleString("en-US")}.${fraction}`
    : whole.toLocaleString("en-US");
  return micros < 0 ? `−${amount}` : amount;
}

/** A UTC time of day split where it is set in two inks: "16:13:35" and ".412". */
export function timeOfDayParts(instant: string | number): { clock: string; millis: string } {
  const iso = new Date(instant).toISOString();
  return { clock: iso.slice(11, 19), millis: iso.slice(19, 23) };
}

/**
 * How many leading characters every ID in a list shares, cut back to the end
 * of a whole group ("01a20e9a-"). That part says nothing about which row is
 * which, so it is set quieter than the rest. With fewer than two IDs nothing
 * is shared.
 */
export function sharedIdPrefix(ids: readonly string[]): number {
  const [first, ...others] = ids;
  if (first === undefined || others.length === 0) return 0;
  let length = first.length;
  for (const id of others) {
    let same = 0;
    while (same < length && same < id.length && id[same] === first[same]) same++;
    length = same;
  }
  // A whole ID shared by every row (the same message twice) is not a prefix.
  if (length === first.length) return 0;
  return first.lastIndexOf("-", length - 1) + 1;
}
