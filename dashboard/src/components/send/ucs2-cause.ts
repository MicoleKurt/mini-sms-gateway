import { analyze, detectEncoding, splitSegments, type SmsAnalysis } from "@/lib/sms-encoding";

/** At most this many characters are named one by one; beyond it the text is simply not GSM-7. */
export const MAX_NAMED_CAUSES = 3;

export interface Ucs2Cause {
  char: string;
  /** For example "U+1F4E6". */
  codePoint: string;
  /** Where it is first used, counted in characters from 1. */
  position: number;
  /** The segment it is first used in, from 1. */
  segment: number;
  /** How many times it is used. */
  uses: number;
}

export interface Ucs2Explanation {
  causes: Ucs2Cause[];
  /**
   * The same text with every cause taken out, when there are few enough
   * causes that removing them leaves a message worth comparing.
   */
  without: SmsAnalysis | null;
}

export function forcesUcs2(char: string): boolean {
  return detectEncoding(char) === "UCS2";
}

function codePointOf(char: string): string {
  return `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * Why a text is sent as UCS-2: each character outside the GSM-7 alphabet
 * with its code point, where it first appears, and what the text would be
 * without them. Null for a GSM-7 text.
 */
export function explainUcs2(text: string): Ucs2Explanation | null {
  if (detectEncoding(text) === "GSM7") return null;

  const byChar = new Map<string, Ucs2Cause>();
  let position = 0;
  splitSegments(text).forEach((segment, index) => {
    for (const char of segment.text) {
      position += 1;
      if (!forcesUcs2(char)) continue;
      const known = byChar.get(char);
      if (known) known.uses += 1;
      else {
        byChar.set(char, {
          char,
          codePoint: codePointOf(char),
          position,
          segment: index + 1,
          uses: 1,
        });
      }
    }
  });

  const causes = Array.from(byChar.values());
  const without =
    causes.length <= MAX_NAMED_CAUSES
      ? analyze(
          Array.from(text)
            .filter((char) => !forcesUcs2(char))
            .join(""),
        )
      : null;
  return { causes, without };
}
