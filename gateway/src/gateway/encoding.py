"""SMS encoding detection and segment counting (GSM 03.38 / UCS-2).

Pure functions, no I/O. The dashboard has a TypeScript port of this module
(`dashboard/src/lib/sms-encoding.ts`). Both are checked against the same
vectors in `shared/encoding-vectors.json`, so they cannot drift apart silently.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Encoding = Literal["GSM7", "UCS2"]

# GSM 03.38 default alphabet. Each of these is one septet.
GSM7_BASIC = frozenset(
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ"
    " !\"#¤%&'()*+,-./0123456789:;<=>?"
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§"
    "¿abcdefghijklmnopqrstuvwxyzäöñüà"
)

# GSM 03.38 extension table. Each is sent as ESC + char, so two septets.
GSM7_EXTENSION = frozenset("\f^{}\\[~]|€")

GSM7_SINGLE = 160
GSM7_MULTI = 153
UCS2_SINGLE = 70
UCS2_MULTI = 67


@dataclass(frozen=True, slots=True)
class SmsAnalysis:
    encoding: Encoding
    #: Septets for GSM-7, UTF-16 code units for UCS-2.
    units: int
    segments: int
    #: Capacity of one segment at the current segment count.
    units_per_segment: int


def detect_encoding(text: str) -> Encoding:
    """GSM-7 if every character is in the GSM 03.38 set, otherwise UCS-2."""
    for ch in text:
        if ch not in GSM7_BASIC and ch not in GSM7_EXTENSION:
            return "UCS2"
    return "GSM7"


def _pack(weights: list[int], single: int, multi: int) -> tuple[int, int]:
    """Count segments for a list of indivisible units.

    A two-unit character (a GSM-7 escape pair or a UTF-16 surrogate pair) is
    never split across two segments. If it does not fit in what is left of a
    segment, it starts the next one and the spare unit is lost.
    """
    total = sum(weights)
    if total <= single:
        return total, 1
    segments = 1
    fill = 0
    for w in weights:
        if fill + w > multi:
            segments += 1
            fill = 0
        fill += w
    return total, segments


def analyze(text: str) -> SmsAnalysis:
    """Return the encoding, unit count and segment count of a message body."""
    encoding = detect_encoding(text)
    if encoding == "GSM7":
        weights = [2 if ch in GSM7_EXTENSION else 1 for ch in text]
        units, segments = _pack(weights, GSM7_SINGLE, GSM7_MULTI)
        per_segment = GSM7_SINGLE if segments == 1 else GSM7_MULTI
    else:
        # A character outside the Basic Multilingual Plane (most emoji) is a
        # surrogate pair: two UTF-16 code units.
        weights = [2 if ord(ch) > 0xFFFF else 1 for ch in text]
        units, segments = _pack(weights, UCS2_SINGLE, UCS2_MULTI)
        per_segment = UCS2_SINGLE if segments == 1 else UCS2_MULTI
    return SmsAnalysis(encoding=encoding, units=units, segments=segments, units_per_segment=per_segment)
