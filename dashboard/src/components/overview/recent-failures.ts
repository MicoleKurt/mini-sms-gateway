import type { Message } from "@/lib/api/schemas";
import { epochMicros } from "@/lib/format";
import type { MessageStatus } from "@/lib/status";

/** The outcomes that need a look. A delivered message is never listed. */
export const FAILURE_STATUSES = [
  "FAILED",
  "UNDELIVERED",
  "EXPIRED",
] as const satisfies readonly MessageStatus[];

export const RECENT_FAILURES_SHOWN = 6;

export function isFailure(status: MessageStatus): boolean {
  return (FAILURE_STATUSES as readonly MessageStatus[]).includes(status);
}

/** When the message reached its outcome; the creation time until it is final. */
export function failedAt(message: Message): string {
  return message.finalized_at ?? message.created_at;
}

/**
 * The newest failures across several lists, newest first. A message in more
 * than one list keeps its first copy, so pass the freshest list first.
 */
export function mergeFailures(
  lists: readonly (readonly Message[])[],
  limit = RECENT_FAILURES_SHOWN,
): Message[] {
  const seen = new Set<string>();
  const merged: Message[] = [];
  for (const list of lists) {
    for (const message of list) {
      if (seen.has(message.id) || !isFailure(message.status)) continue;
      seen.add(message.id);
      merged.push(message);
    }
  }
  return merged.sort((a, b) => epochMicros(failedAt(b)) - epochMicros(failedAt(a))).slice(0, limit);
}
