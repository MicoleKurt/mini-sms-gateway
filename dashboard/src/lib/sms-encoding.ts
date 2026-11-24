/**
 * SMS encoding detection and segment counting (GSM 03.38 / UCS-2).
 *
 * This is a port of gateway/src/gateway/encoding.py. Both are checked against
 * shared/encoding-vectors.json, so the preview on the send page shows the same
 * encoding, segment count and price that the gateway will charge.
 *
 * Text is always walked by code point (`for...of`, `Array.from`), never by
 * UTF-16 unit, so an emoji is one character that weighs two units.
 */

export type Encoding = "GSM7" | "UCS2";

// GSM 03.38 default alphabet. Each of these is one septet.
const GSM7_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ" +
    " !\"#¤%&'()*+,-./0123456789:;<=>?" +
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§" +
    "¿abcdefghijklmnopqrstuvwxyzäöñüà",
);

// GSM 03.38 extension table. Each is sent as ESC + char, so two septets.
const GSM7_EXTENSION = new Set("\f^{}\\[~]|€");

const GSM7_SINGLE = 160;
const GSM7_MULTI = 153;
const UCS2_SINGLE = 70;
const UCS2_MULTI = 67;

export interface SmsAnalysis {
  encoding: Encoding;
  /** Septets for GSM-7, UTF-16 code units for UCS-2. */
  units: number;
  segments: number;
  /** Capacity of one segment at the current segment count. */
  unitsPerSegment: number;
}

export interface Segment {
  text: string;
  /** Units of this segment, in the encoding of the whole message. */
  units: number;
}

export interface ForcingCharacter {
  char: string;
  /** For example "U+1F600". */
  codePoint: string;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function isGsm7(char: string): boolean {
  return GSM7_BASIC.has(char) || GSM7_EXTENSION.has(char);
}

/** GSM-7 if every character is in the GSM 03.38 set, otherwise UCS-2. */
export function detectEncoding(text: string): Encoding {
  for (const char of text) {
    if (!isGsm7(char)) return "UCS2";
  }
  return "GSM7";
}

function weigh(char: string, encoding: Encoding): number {
  if (encoding === "GSM7") return GSM7_EXTENSION.has(char) ? 2 : 1;
  // A character outside the Basic Multilingual Plane (most emoji) is a
  // surrogate pair: two UTF-16 code units.
  return char.codePointAt(0)! > 0xffff ? 2 : 1;
}

interface Layout {
  encoding: Encoding;
  chars: string[];
  weights: number[];
  units: number;
  /** Index into `chars` where each segment starts. Always starts with 0. */
  segmentStarts: number[];
}

/**
 * Lay the text out into segments.
 *
 * A two-unit character (a GSM-7 escape pair or a UTF-16 surrogate pair) is
 * never split across two segments. If it does not fit in what is left of a
 * segment, it starts the next one and the spare unit is lost.
 */
function layOut(text: string): Layout {
  const encoding = detectEncoding(text);
  const chars = Array.from(text);
  const weights = chars.map((char) => weigh(char, encoding));
  const units = sum(weights);
  const single = encoding === "GSM7" ? GSM7_SINGLE : UCS2_SINGLE;
  const multi = encoding === "GSM7" ? GSM7_MULTI : UCS2_MULTI;

  const segmentStarts = [0];
  if (units > single) {
    let fill = 0;
    weights.forEach((weight, index) => {
      if (fill + weight > multi) {
        segmentStarts.push(index);
        fill = 0;
      }
      fill += weight;
    });
  }
  return { encoding, chars, weights, units, segmentStarts };
}

/** Return the encoding, unit count and segment count of a message body. */
export function analyze(text: string): SmsAnalysis {
  const { encoding, units, segmentStarts } = layOut(text);
  const segments = segmentStarts.length;
  const unitsPerSegment =
    encoding === "GSM7"
      ? segments === 1
        ? GSM7_SINGLE
        : GSM7_MULTI
      : segments === 1
        ? UCS2_SINGLE
        : UCS2_MULTI;
  return { encoding, units, segments, unitsPerSegment };
}

/** Each segment's text and the units it uses, in order. The texts joined are the input. */
export function splitSegments(text: string): Segment[] {
  const { chars, weights, segmentStarts } = layOut(text);
  return segmentStarts.map((start, index) => {
    const end = segmentStarts[index + 1];
    return { text: chars.slice(start, end).join(""), units: sum(weights.slice(start, end)) };
  });
}

/** The distinct characters that are not in GSM 03.38, in order of first use. */
export function charactersForcingUcs2(text: string): ForcingCharacter[] {
  const seen = new Set<string>();
  for (const char of text) {
    if (!isGsm7(char)) seen.add(char);
  }
  return Array.from(seen, (char) => ({
    char,
    codePoint: `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`,
  }));
}
