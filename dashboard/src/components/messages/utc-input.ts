/**
 * The From and To fields take a UTC time as text, "2026-11-24 16:13", so the
 * bounds read the same as the UTC times in the table.
 */

export function formatUtcInput(date: Date | null): string {
  return date ? date.toISOString().slice(0, 16).replace("T", " ") : "";
}

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * Read a UTC time typed as "YYYY-MM-DD", "YYYY-MM-DD HH:MM" or with seconds.
 * An empty field is no bound (null); anything else that is not a real time
 * is "invalid".
 */
export function parseUtcInput(text: string): Date | null | "invalid" {
  const value = text.trim();
  if (value === "") return null;
  const match = PATTERN.exec(value);
  if (!match) return "invalid";

  const [year, month, day, hours = 0, minutes = 0, seconds = 0] = match
    .slice(1)
    .map((part) => (part === undefined ? undefined : Number(part)));
  const date = new Date(Date.UTC(year!, month! - 1, day!, hours, minutes, seconds));
  // Date.UTC rolls 31 Nov over into December; a real date survives the round trip.
  const real =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month! - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hours &&
    date.getUTCMinutes() === minutes;
  return real ? date : "invalid";
}
