"""Input validation for a message. Strict on purpose: the API never repairs input.

A number with spaces, a missing "+" or a national format is rejected, not
"fixed". Guessing a destination is how an OTP reaches the wrong person.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from gateway.encoding import SmsAnalysis, analyze
from gateway.pricing import Price, PriceTable

# [0-9], not \d: in Python \d also matches digits of other scripts (for
# example Bengali digits), and a phone number in those is not E.164.
_E164 = re.compile(r"\+[1-9][0-9]{6,14}")
_SENDER_ALPHANUMERIC = re.compile(r"[A-Za-z0-9 ]{1,11}")
_SENDER_NUMERIC = re.compile(r"[0-9]{3,15}")

MAX_CLIENT_REF = 64


@dataclass(frozen=True, slots=True)
class MessageDraft:
    """A message that passed validation and has a price."""

    to: str
    sender: str
    text: str
    client_ref: str | None
    analysis: SmsAnalysis
    price: Price

    @property
    def cost_micros(self) -> int:
        return self.analysis.segments * self.price.price_per_segment_micros


def is_e164(value: str) -> bool:
    # fullmatch, not match with "$": "$" would accept a trailing newline.
    return _E164.fullmatch(value) is not None


def is_sender_id(value: str) -> bool:
    if _SENDER_NUMERIC.fullmatch(value):
        return True
    return _SENDER_ALPHANUMERIC.fullmatch(value) is not None and value.strip() != ""


def validate_message(
    *,
    to: str,
    sender: str,
    text: str,
    client_ref: str | None,
    prices: PriceTable,
    max_segments: int,
) -> tuple[MessageDraft | None, list[dict[str, Any]]]:
    """Return a draft, or the list of everything that is wrong with the input."""
    errors: list[dict[str, Any]] = []
    price: Price | None = None

    if not is_e164(to):
        errors.append(_err("to", "INVALID_E164", "Must be an E.164 number, for example +8801711000001."))
    else:
        price = prices.lookup(to)
        if price is None:
            errors.append(
                _err("to", "UNSUPPORTED_DESTINATION", "There is no price for this destination prefix.")
            )

    if not is_sender_id(sender):
        errors.append(
            _err(
                "from",
                "INVALID_SENDER_ID",
                "Must be 1 to 11 letters, digits or spaces, or a number of 3 to 15 digits.",
            )
        )

    analysis: SmsAnalysis | None = None
    if text == "":
        errors.append(_err("text", "EMPTY_TEXT", "Must not be empty."))
    elif not is_storable(text):
        errors.append(_err("text", "INVALID_VALUE", "Contains a NUL character or an unpaired surrogate."))
    else:
        analysis = analyze(text)
        if analysis.segments > max_segments:
            errors.append(
                _err(
                    "text",
                    "MESSAGE_TOO_LONG",
                    f"Needs {analysis.segments} segments ({analysis.encoding}); the limit is {max_segments}.",
                )
            )

    if client_ref is not None and not (1 <= len(client_ref) <= MAX_CLIENT_REF and is_storable(client_ref)):
        errors.append(_err("client_ref", "INVALID_VALUE", f"Must be 1 to {MAX_CLIENT_REF} characters."))

    if errors or price is None or analysis is None:
        return None, errors
    return MessageDraft(to, sender, text, client_ref, analysis, price), []


def is_storable(value: str) -> bool:
    """PostgreSQL text cannot hold NUL, and UTF-8 cannot encode half a surrogate pair."""
    if "\x00" in value:
        return False
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return True


def _err(field: str, code: str, message: str) -> dict[str, Any]:
    return {"field": field, "code": code, "message": message}
