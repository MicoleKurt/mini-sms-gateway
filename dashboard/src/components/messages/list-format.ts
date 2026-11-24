import type { Message } from "@/lib/api/schemas";
import { epochMicros } from "@/lib/format";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The UTC day of an instant, the way a group row names it: "Tuesday 24 Nov 2026". */
export function utcDayLabel(iso: string): string {
  const date = new Date(iso);
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export interface DayGroup {
  /** The UTC date, "2026-11-24". */
  day: string;
  label: string;
  messages: Message[];
}

/** Consecutive messages of one UTC day, in the order they came. */
export function groupByUtcDay(messages: readonly Message[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const message of messages) {
    const day = new Date(message.created_at).toISOString().slice(0, 10);
    const last = groups.at(-1);
    if (last?.day === day) last.messages.push(message);
    else groups.push({ day, label: utcDayLabel(message.created_at), messages: [message] });
  }
  return groups;
}

/**
 * The part of a message ID the list shows, and the rest. IDs are time-ordered
 * (UUIDv7): the first two groups are the millisecond the message was accepted,
 * which every message of a batch shares. The third group is the first one
 * that tells those apart.
 */
export function splitListId(id: string): { shown: string; rest: string } {
  const groups = id.split("-");
  if (groups.length < 3) return { shown: id, rest: "" };
  const shown = groups.slice(0, 3).join("-");
  return { shown, rest: id.slice(shown.length) };
}

/** Seconds from accept to the final status, or null while the message is not final. */
export function secondsToFinal(message: Message): string | null {
  if (message.finalized_at === null) return null;
  const microseconds = epochMicros(message.finalized_at) - epochMicros(message.created_at);
  return (Math.max(0, microseconds) / 1_000_000).toFixed(2);
}

/**
 * The messages newer than the newest one that was shown before: the rows
 * that arrived. Nothing arrives into a list that was not shown yet.
 */
export function arrivedSince(
  messages: readonly Message[],
  previousNewestAt: string | null,
): ReadonlySet<string> {
  if (previousNewestAt === null) return new Set();
  const before = epochMicros(previousNewestAt);
  return new Set(
    messages.filter((message) => epochMicros(message.created_at) > before).map(({ id }) => id),
  );
}
