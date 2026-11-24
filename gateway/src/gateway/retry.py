"""Retry rules for a submit attempt. This file is the whole policy.

To change what is retried, edit `RULES`. To change how long we wait, edit
`backoff_seconds`. Nothing else in the dispatcher knows about HTTP codes.
"""

from __future__ import annotations

import enum
import random
from dataclasses import dataclass

from gateway.carrier import Outcome, SubmitResult


class Action(enum.Enum):
    DONE = "done"  # the carrier has the message
    RETRY = "retry"  # try again later, if attempts are left
    FAIL = "fail"  # permanent: never retry


@dataclass(frozen=True, slots=True)
class Rule:
    action: Action
    #: True if the carrier may have accepted the message although we got no ID.
    ambiguous: bool = False


RULES: dict[Outcome, Rule] = {
    Outcome.ACCEPTED: Rule(Action.DONE),
    Outcome.RATE_LIMITED: Rule(Action.RETRY),  # 429
    Outcome.UNAVAILABLE: Rule(Action.RETRY),  # 503, connection refused
    Outcome.TIMEOUT: Rule(Action.RETRY, ambiguous=True),  # no answer: retry, but flag it
    Outcome.REJECTED: Rule(Action.FAIL),  # 400 INVALID_DESTINATION
}


@dataclass(frozen=True, slots=True)
class Decision:
    action: Action
    ambiguous: bool = False
    delay_seconds: float = 0.0
    reason: str | None = None


def decide(
    result: SubmitResult,
    *,
    attempt: int,
    max_attempts: int,
    base_seconds: float,
    max_seconds: float,
    rng: random.Random | None = None,
) -> Decision:
    rule = RULES[result.outcome]
    if rule.action is Action.DONE:
        return Decision(Action.DONE)
    if rule.action is Action.FAIL:
        return Decision(Action.FAIL, reason=result.error or result.outcome.value)
    if attempt >= max_attempts:
        return Decision(Action.FAIL, ambiguous=rule.ambiguous, reason="MAX_ATTEMPTS_EXCEEDED")
    delay = backoff_seconds(attempt, base_seconds, max_seconds, rng)
    if result.retry_after is not None:
        delay = max(delay, min(result.retry_after, max_seconds))
    return Decision(Action.RETRY, ambiguous=rule.ambiguous, delay_seconds=delay)


def backoff_seconds(
    attempt: int, base_seconds: float, max_seconds: float, rng: random.Random | None = None
) -> float:
    """Exponential backoff with jitter: between half and all of base * 2^(attempt-1).

    The jitter spreads out messages that failed together (a carrier blip
    fails many at once) so they do not all come back in the same instant.
    """
    ceiling = min(max_seconds, base_seconds * (2 ** (attempt - 1)))
    return (rng or random).uniform(ceiling / 2, ceiling)
