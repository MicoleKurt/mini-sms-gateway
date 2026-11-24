from dataclasses import asdict, dataclass, fields

from mock_carrier.clock import utc_now_iso


@dataclass
class CarrierStats:
    """Counters behind GET /stats. Field names and order are the response shape."""

    received: int = 0
    accepted: int = 0
    rate_limited: int = 0
    temporary_failures: int = 0
    permanent_failures: int = 0
    timeouts: int = 0
    unique_message_ids_accepted: int = 0
    duplicate_accepts: int = 0
    dlrs_sent: int = 0
    dlrs_failed: int = 0
    max_submits_in_one_second: int = 0
    first_submit_at: str | None = None
    last_submit_at: str | None = None

    def record_submit(self) -> None:
        now = utc_now_iso()
        self.received += 1
        self.first_submit_at = self.first_submit_at or now
        self.last_submit_at = now

    def reset(self) -> None:
        for counter in fields(self):
            setattr(self, counter.name, counter.default)

    def as_dict(self) -> dict[str, int | str | None]:
        return asdict(self)
