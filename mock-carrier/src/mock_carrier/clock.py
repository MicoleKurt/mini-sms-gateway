from datetime import UTC, datetime


def utc_now_iso() -> str:
    """Current time in the API's format, for example 2026-11-24T15:04:05.123456Z."""
    return datetime.now(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")
