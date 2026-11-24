"""Regenerate shared/encoding-vectors.json from the Python implementation.

The Python unit tests assert hand-computed values (tests/test_encoding.py).
This file only freezes the Python results so the TypeScript port in the
dashboard can be checked against exactly the same inputs.

    uv run python scripts/gen_encoding_vectors.py
"""

from __future__ import annotations

import json
from pathlib import Path

from gateway.encoding import analyze

CASES: list[tuple[str, str]] = [
    ("single ascii", "Your code is 482913"),
    ("one character", "a"),
    ("gsm basic specials", "@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¡ÄÖÑÜ§¿äöñüà"),
    ("newline and carriage return", "line1\nline2\r\n"),
    ("exactly 160 septets", "a" * 160),
    ("161 septets", "a" * 161),
    ("exactly 306 septets", "a" * 306),
    ("307 septets", "a" * 307),
    ("every extension character", "\f^{}\\[~]|€"),
    ("extension characters count double", "{" * 80),
    ("81 extension characters", "{" * 81),
    ("euro sign", "Total: 12€"),
    ("extension pair is not split at a segment boundary", "a" * 152 + "{" + "a" * 10),
    ("extension pair fits exactly at a segment boundary", "a" * 151 + "{" + "a" * 10),
    # 306 septets is 2 x 153, but the escape pair would straddle the first
    # boundary, so it moves to segment 2 and pushes the tail into segment 3.
    ("extension pair at a boundary costs a third segment", "a" * 152 + "{" + "a" * 152),
    ("bangla", "আপনার কোড 482913"),
    # 134 units is 2 x 67, but the surrogate pair would straddle the boundary.
    ("surrogate pair at a boundary costs a third segment", "ক" * 66 + "\U0001f600" + "ক" * 66),
    ("single emoji", "\U0001f600"),
    ("ascii plus emoji", "Sale today \U0001f389"),
    ("exactly 70 ucs2 units", "ক" * 70),
    ("71 ucs2 units", "ক" * 71),
    ("exactly 134 ucs2 units", "ক" * 134),
    ("135 ucs2 units", "ক" * 135),
    ("35 emoji", "\U0001f600" * 35),
    ("36 emoji", "\U0001f600" * 36),
    ("surrogate pair is not split at a segment boundary", "ক" * 66 + "\U0001f600" + "ক" * 10),
    ("backtick is not gsm", "`quoted`"),
    ("tab is not gsm", "a\tb"),
    ("curly quote is not gsm", "It’s here"),
    ("cyrillic", "Привет"),
    ("arabic", "مرحبا بك"),
    ("capital c cedilla is gsm, small is not", "Ça va ç"),
]


def main() -> None:
    out = []
    for name, text in CASES:
        a = analyze(text)
        out.append({"name": name, "text": text, "encoding": a.encoding, "units": a.units, "segments": a.segments})
    target = Path(__file__).resolve().parents[2] / "shared" / "encoding-vectors.json"
    target.write_text(json.dumps(out, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(out)} vectors to {target}")


if __name__ == "__main__":
    main()
