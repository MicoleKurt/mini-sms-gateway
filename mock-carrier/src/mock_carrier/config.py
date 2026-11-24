"""Environment parsing for both apps. Names and defaults follow docs/API.md."""

import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import TypeVar

T = TypeVar("T")

# Float sums such as 0.7 + 0.2 + 0.1 can land a hair above 1.0.
_SUM_TOLERANCE = 1e-9


def _raw(env: Mapping[str, str], name: str) -> str | None:
    """The value of a variable, or None when it is unset or blank."""
    value = env.get(name, "").strip()
    return value or None


def _parse(env: Mapping[str, str], name: str, convert: Callable[[str], T], expected: str) -> T | None:
    raw = _raw(env, name)
    if raw is None:
        return None
    try:
        return convert(raw)
    except ValueError:
        raise ValueError(f"{name}: expected {expected}, got {raw!r}") from None


def _bool(raw: str) -> bool:
    if raw.lower() in ("true", "1", "yes"):
        return True
    if raw.lower() in ("false", "0", "no"):
        return False
    raise ValueError


def _or(value: T | None, default: T) -> T:
    return default if value is None else value


def _require_probability(name: str, value: float) -> None:
    if not 0.0 <= value <= 1.0:
        raise ValueError(f"{name}: expected a share between 0 and 1, got {value}")


def _require_range(low_name: str, low: float, high_name: str, high: float) -> None:
    if not 0 <= low <= high:
        raise ValueError(f"{low_name} and {high_name}: expected 0 <= min <= max, got {low} and {high}")


@dataclass(frozen=True)
class CarrierConfig:
    gateway_url: str = "http://gateway:8000"
    # The contract gives no default. This is the documented local demo value, so the
    # carrier starts with no environment at all.
    dlr_secret: str = "dev-dlr-secret"
    min_latency_ms: int = 20
    max_latency_ms: int = 300
    rate_limit_per_sec: int = 50
    p_temporary_failure: float = 0.03
    p_permanent_failure: float = 0.01
    p_timeout: float = 0.01
    timeout_seconds: float = 5.0
    dlr_min_delay_ms: int = 500
    dlr_max_delay_ms: int = 10_000
    p_delivrd: float = 0.90
    p_undeliv: float = 0.07
    p_expired: float = 0.03
    p_dlr_duplicate: float = 0.10
    p_dlr_early: float = 0.05
    idempotent_submit: bool = False
    random_seed: int | None = None

    def __post_init__(self) -> None:
        if not self.dlr_secret:
            raise ValueError("DLR_SECRET: must not be empty")
        if self.rate_limit_per_sec < 1:
            raise ValueError(f"RATE_LIMIT_PER_SEC: expected at least 1, got {self.rate_limit_per_sec}")
        if self.timeout_seconds < 0:
            raise ValueError(f"TIMEOUT_SECONDS: expected 0 or more, got {self.timeout_seconds}")
        _require_range("MIN_LATENCY_MS", self.min_latency_ms, "MAX_LATENCY_MS", self.max_latency_ms)
        _require_range("DLR_MIN_DELAY_MS", self.dlr_min_delay_ms, "DLR_MAX_DELAY_MS", self.dlr_max_delay_ms)

        for name in (
            "p_temporary_failure",
            "p_permanent_failure",
            "p_timeout",
            "p_delivrd",
            "p_undeliv",
            "p_expired",
            "p_dlr_duplicate",
            "p_dlr_early",
        ):
            _require_probability(name.upper(), getattr(self, name))

        # One random draw picks between 503, 400, timeout and plain accept, so the
        # three shares have to fit inside 1.
        outcome_total = self.p_temporary_failure + self.p_permanent_failure + self.p_timeout
        if outcome_total > 1.0 + _SUM_TOLERANCE:
            raise ValueError(
                "P_TEMPORARY_FAILURE + P_PERMANENT_FAILURE + P_TIMEOUT: "
                f"expected at most 1, got {outcome_total}"
            )
        if self.p_delivrd + self.p_undeliv + self.p_expired <= 0:
            raise ValueError("P_DELIVRD, P_UNDELIV, P_EXPIRED: at least one must be above 0")

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "CarrierConfig":
        env = os.environ if env is None else env
        default = cls()

        def integer(name: str, fallback: int) -> int:
            return _or(_parse(env, name, int, "an integer"), fallback)

        def number(name: str, fallback: float) -> float:
            return _or(_parse(env, name, float, "a number"), fallback)

        return cls(
            gateway_url=_or(_raw(env, "GATEWAY_URL"), default.gateway_url).rstrip("/"),
            dlr_secret=_or(_raw(env, "DLR_SECRET"), default.dlr_secret),
            min_latency_ms=integer("MIN_LATENCY_MS", default.min_latency_ms),
            max_latency_ms=integer("MAX_LATENCY_MS", default.max_latency_ms),
            rate_limit_per_sec=integer("RATE_LIMIT_PER_SEC", default.rate_limit_per_sec),
            p_temporary_failure=number("P_TEMPORARY_FAILURE", default.p_temporary_failure),
            p_permanent_failure=number("P_PERMANENT_FAILURE", default.p_permanent_failure),
            p_timeout=number("P_TIMEOUT", default.p_timeout),
            timeout_seconds=number("TIMEOUT_SECONDS", default.timeout_seconds),
            dlr_min_delay_ms=integer("DLR_MIN_DELAY_MS", default.dlr_min_delay_ms),
            dlr_max_delay_ms=integer("DLR_MAX_DELAY_MS", default.dlr_max_delay_ms),
            p_delivrd=number("P_DELIVRD", default.p_delivrd),
            p_undeliv=number("P_UNDELIV", default.p_undeliv),
            p_expired=number("P_EXPIRED", default.p_expired),
            p_dlr_duplicate=number("P_DLR_DUPLICATE", default.p_dlr_duplicate),
            p_dlr_early=number("P_DLR_EARLY", default.p_dlr_early),
            idempotent_submit=_or(
                _parse(env, "IDEMPOTENT_SUBMIT", _bool, "true or false"), default.idempotent_submit
            ),
            random_seed=_parse(env, "RANDOM_SEED", int, "an integer"),
        )


_SINK_FAIL_PREFIX = "SINK_FAIL_"
_SINK_DELAY_PREFIX = "SINK_DELAY_MS_"


def sink_env_suffix(tenant_slug: str) -> str:
    """The tenant part of a sink variable name: acme-bank -> ACME_BANK."""
    return tenant_slug.upper().replace("-", "_")


def _delay_range(raw: str) -> tuple[int, int]:
    """Parse "min-max" in milliseconds, for example 200-1500."""
    low, separator, high = raw.partition("-")
    if not separator:
        raise ValueError
    delay = (int(low), int(high))
    if not 0 <= delay[0] <= delay[1]:
        raise ValueError
    return delay


@dataclass(frozen=True)
class SinkBehaviour:
    """How the sink treats one tenant. The default is fast and always 200."""

    fail_share: float = 0.0
    delay_ms: tuple[int, int] = (0, 0)


@dataclass(frozen=True)
class SinkConfig:
    # Keyed by the variable suffix (ACME_BANK), because that is all the environment gives us.
    tenants: Mapping[str, SinkBehaviour] = field(default_factory=dict)

    def behaviour_for(self, tenant_slug: str) -> SinkBehaviour:
        return self.tenants.get(sink_env_suffix(tenant_slug), SinkBehaviour())

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "SinkConfig":
        env = os.environ if env is None else env
        fail_shares: dict[str, float] = {}
        delays: dict[str, tuple[int, int]] = {}
        for name in env:
            if name.startswith(_SINK_FAIL_PREFIX):
                share = _parse(env, name, float, "a share between 0 and 1")
                if share is not None:
                    _require_probability(name, share)
                    fail_shares[name.removeprefix(_SINK_FAIL_PREFIX)] = share
            elif name.startswith(_SINK_DELAY_PREFIX):
                delay = _parse(env, name, _delay_range, "min-max in milliseconds, for example 200-1500")
                if delay is not None:
                    delays[name.removeprefix(_SINK_DELAY_PREFIX)] = delay
        return cls(
            tenants={
                suffix: SinkBehaviour(fail_shares.get(suffix, 0.0), delays.get(suffix, (0, 0)))
                for suffix in fail_shares.keys() | delays.keys()
            }
        )
