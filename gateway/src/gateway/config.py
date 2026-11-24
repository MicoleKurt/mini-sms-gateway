"""Runtime configuration. Every value can be set through an environment variable."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://smsgw:smsgw@localhost:5432/smsgw"
    redis_url: str = "redis://localhost:6379/0"
    carrier_url: str = "http://localhost:9000"
    dlr_secret: str = "dev-dlr-secret"
    admin_token: str = "dev-admin-token"
    #: Redis pub/sub channel for dashboard live events.
    live_channel: str = "smsgw:live"
    #: Longest wait for a Valkey connect or reply before the call fails.
    redis_timeout_seconds: float = 1.0

    db_pool_min: int = 2
    db_pool_max: int = 12

    # --- API ---------------------------------------------------------------
    max_segments: int = 10
    price_cache_seconds: float = 30.0

    # --- Dispatch ------------------------------------------------------------
    #: The carrier's hard limit, in submits per second, across everything we run.
    carrier_rate_limit: int = 50
    #: We aim below the limit. Our clock and the carrier's window are not the
    #: same thing, so a target of exactly 50 would produce 429s.
    carrier_rate_headroom: float = 0.92
    #: Submits that may go out back to back. Worst case in any one second is
    #: target rate + burst, which must stay <= carrier_rate_limit.
    carrier_burst: int = 2
    carrier_timeout_seconds: float = 2.0
    #: Pause for all workers after the carrier says 429.
    carrier_429_penalty_seconds: float = 0.25
    max_attempts: int = 6
    retry_base_seconds: float = 0.5
    retry_max_seconds: float = 30.0
    #: How long a claimed message stays invisible to other workers. Must be
    #: comfortably longer than carrier_timeout_seconds.
    lease_seconds: float = 30.0
    worker_max_in_flight: int = 32
    #: Claim -> token -> send loops per worker process. Each holds at most one
    #: claimed message while it waits for a token. More lanes keep the carrier
    #: slots filled when a claim is slow; fewer keep an OTP closer to the front.
    worker_lanes: int = 2
    worker_idle_poll_seconds: float = 0.1
    worker_shutdown_grace_seconds: float = 10.0

    # --- Tenant webhooks -----------------------------------------------------
    webhook_timeout_seconds: float = 5.0
    webhook_max_attempts: int = 6
    webhook_retry_base_seconds: float = 1.0
    webhook_retry_max_seconds: float = 60.0
    webhook_lease_seconds: float = 30.0
    #: One tenant's slow endpoint can hold at most this many of our sockets.
    webhook_per_tenant_concurrency: int = 8
    webhook_idle_poll_seconds: float = 0.25

    # --- Lost DLRs (swept in the webhook process) ----------------------------
    #: A message SUBMITTED for longer than this without a DLR becomes EXPIRED.
    #: The carrier's validity period.
    dlr_wait_seconds: float = 86_400.0
    dlr_sweep_interval_seconds: float = 60.0
    dlr_sweep_batch_size: int = 500

    # --- Observability -------------------------------------------------------
    log_level: str = "INFO"
    #: If set, worker processes serve Prometheus metrics on this port.
    metrics_port: int | None = None

    # --- Seed data (local demo) ----------------------------------------------
    seed_acme_api_key: str = "sk_acme_dev_3f9c1d7e5b2a4c68"
    seed_shopfast_api_key: str = "sk_shop_dev_8e2b6a4f1c9d7053"
    seed_acme_callback_url: str | None = None
    seed_shopfast_callback_url: str | None = None

    @property
    def carrier_target_rate(self) -> float:
        """Submits per second the limiter hands out in steady state."""
        return self.carrier_rate_limit * self.carrier_rate_headroom


@lru_cache
def get_settings() -> Settings:
    return Settings()
