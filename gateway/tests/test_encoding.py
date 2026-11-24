"""Encoding detection and segment counting. Expected values are worked out by
hand from GSM 03.38, not copied from the implementation."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from gateway.encoding import analyze, detect_encoding

BANGLA = "আপনার কোড 482913"  # "Your code is 482913"


@pytest.mark.parametrize(
    ("text", "encoding"),
    [
        ("Your code is 482913", "GSM7"),
        ("Price: £5 or ¥700, ça va? ÆØÅ ñ ü", "UCS2"),  # small c-cedilla is not in GSM 03.38
        ("Price: £5 or ¥700 ÆØÅ ñ ü Ç", "GSM7"),  # capital C-cedilla is
        ("{ } [ ] ~ \\ ^ | €", "GSM7"),  # extension table
        (BANGLA, "UCS2"),
        ("Sale today 🎉", "UCS2"),
        ("It’s here", "UCS2"),  # typographic apostrophe
        ("tab\there", "UCS2"),
    ],
)
def test_detects_encoding(text: str, encoding: str) -> None:
    assert detect_encoding(text) == encoding


@pytest.mark.parametrize(
    ("length", "segments"),
    [(1, 1), (160, 1), (161, 2), (306, 2), (307, 3), (459, 3), (460, 4)],
)
def test_gsm7_segment_boundaries(length: int, segments: int) -> None:
    result = analyze("a" * length)
    assert (result.encoding, result.units, result.segments) == ("GSM7", length, segments)


def test_gsm7_extension_characters_count_as_two_septets() -> None:
    every_extension_char = "\f^{}\\[~]|€"
    assert len(every_extension_char) == 10
    result = analyze(every_extension_char)
    assert (result.encoding, result.units, result.segments) == ("GSM7", 20, 1)


def test_gsm7_extension_characters_change_the_segment_count() -> None:
    # 80 braces are 160 septets: still one segment. One more tips it over,
    # although the text is only 81 characters long.
    assert analyze("{" * 80).segments == 1
    assert analyze("{" * 81).units == 162
    assert analyze("{" * 81).segments == 2


def test_gsm7_escape_pair_is_not_split_across_segments() -> None:
    # 152 + 2 + 152 = 306 septets, which looks like exactly two segments of
    # 153. But the "{" would occupy septets 153 and 154, across the boundary.
    # It moves to segment 2 whole, and the last character spills into a third.
    result = analyze("a" * 152 + "{" + "a" * 152)
    assert (result.units, result.segments) == (306, 3)
    # One character earlier and it fits: septets 152 and 153.
    assert analyze("a" * 151 + "{" + "a" * 153).segments == 2


@pytest.mark.parametrize(
    ("length", "segments"),
    [(1, 1), (70, 1), (71, 2), (134, 2), (135, 3)],
)
def test_ucs2_segment_boundaries(length: int, segments: int) -> None:
    result = analyze("ক" * length)
    assert (result.encoding, result.units, result.segments) == ("UCS2", length, segments)


def test_ucs2_bangla_message() -> None:
    result = analyze(BANGLA)
    assert (result.encoding, result.units, result.segments) == ("UCS2", 16, 1)


def test_ucs2_emoji_is_two_units() -> None:
    # U+1F600 is outside the BMP: a surrogate pair, two UTF-16 code units.
    assert analyze("😀").units == 2
    assert analyze("😀" * 35).segments == 1  # 70 units
    assert analyze("😀" * 36).segments == 2  # 72 units


def test_ucs2_surrogate_pair_is_not_split_across_segments() -> None:
    result = analyze("ক" * 66 + "😀" + "ক" * 66)
    assert (result.units, result.segments) == (134, 3)


def test_one_non_gsm_character_switches_the_whole_message() -> None:
    gsm = "a" * 100
    assert analyze(gsm).segments == 1
    # The same 100 characters plus one emoji no longer fit in one UCS-2 segment.
    result = analyze(gsm + "😀")
    assert (result.encoding, result.units, result.segments) == ("UCS2", 102, 2)


def test_shared_vectors_are_current() -> None:
    """The file the TypeScript port is tested against must match this implementation."""
    path = Path(__file__).resolve().parents[2] / "shared" / "encoding-vectors.json"
    vectors = json.loads(path.read_text(encoding="utf-8"))
    assert len(vectors) >= 30
    for vector in vectors:
        result = analyze(vector["text"])
        assert (result.encoding, result.units, result.segments) == (
            vector["encoding"],
            vector["units"],
            vector["segments"],
        ), vector["name"]
