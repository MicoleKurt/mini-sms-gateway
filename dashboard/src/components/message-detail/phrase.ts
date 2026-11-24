import { epochMicros, formatDuration } from "@/lib/format";

/**
 * A sentence as pieces, so the words can be tested as plain text and the
 * page can still set each piece in its voice: the verdict bold, a figure in
 * tabular mono, a code (DELIVRD, a URL) in mono, a value that needs a human
 * in the attention ink.
 */
export interface Piece {
  text: string;
  tone?: "verdict" | "figure" | "code" | "attention";
}

export type Phrase = Piece[];

export function words(text: string): Piece {
  return { text };
}

export function figure(text: string): Piece {
  return { text, tone: "figure" };
}

export function code(text: string): Piece {
  return { text, tone: "code" };
}

export function attention(text: string): Piece {
  return { text, tone: "attention" };
}

/** The phrase as plain text: for tests, titles and assistive text. */
export function phraseText(phrase: Phrase): string {
  return phrase.map(({ text }) => text).join("");
}

/** Pieces joined with " · ", the separator of a summary line. */
export function joinWithDots(parts: Phrase[]): Phrase {
  return parts.flatMap((part, index) => (index === 0 ? part : [words(" · "), ...part]));
}

/** Milliseconds from one ISO instant to another, to the microsecond. */
export function millisBetween(from: string, to: string): number {
  return (epochMicros(to) - epochMicros(from)) / 1_000;
}

/**
 * A span of time in seconds, the unit the console measures messages in:
 * "0.303 s", "8.39 s", and "2 min 25 s" from a minute up.
 */
export function formatSeconds(milliseconds: number): string {
  const ms = Math.max(0, milliseconds);
  if (ms < 1_000) return `${(ms / 1_000).toFixed(3)} s`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(2)} s`;
  return formatDuration(ms);
}

/** Like formatSeconds, with three decimals under a minute: "8.393 s". */
export function formatSecondsExact(milliseconds: number): string {
  const ms = Math.max(0, milliseconds);
  return ms < 60_000 ? `${(ms / 1_000).toFixed(3)} s` : formatDuration(ms);
}

/** The UTC time of day of an ISO instant, to the millisecond: "15:57:53.070". */
export function utcClock(iso: string): string {
  return new Date(iso).toISOString().slice(11, 23);
}
