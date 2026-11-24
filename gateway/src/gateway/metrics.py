"""Prometheus metrics. The API serves them at /metrics; a worker serves them on
METRICS_PORT when that is set. Counters are per process.

/metrics on the API needs no credentials, so nothing here carries a tenant
label: an open scrape endpoint must not tell one tenant about another.
"""

from __future__ import annotations

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram

MESSAGES_ACCEPTED = Counter("smsgw_messages_accepted_total", "Messages accepted by the API.")
SUBMIT_ATTEMPTS = Counter(
    "smsgw_submit_attempts_total", "Submit attempts to the carrier, by outcome.", ["outcome"]
)
SUBMIT_SECONDS = Histogram(
    "smsgw_submit_duration_seconds",
    "Carrier response time for a submit.",
    buckets=(0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1.0, 2.0, 5.0),
)
MESSAGES_FINAL = Counter("smsgw_messages_final_total", "Messages that reached a final status.", ["status"])
DLR_RECEIVED = Counter("smsgw_dlr_received_total", "Delivery receipts received, by result.", ["result"])
DLR_DELAY_SECONDS = Histogram(
    "smsgw_dlr_delay_seconds",
    "Time from SUBMITTED to the final status set by a DLR.",
    buckets=(0.5, 1, 2, 3, 5, 8, 10, 15, 30, 60),
)
EXPIRED_WITHOUT_DLR = Counter(
    "smsgw_expired_without_dlr_total", "Messages expired by the sweep because no DLR came in time."
)
ACCEPTED_AFTER_FAILED = Counter(
    "smsgw_accepted_after_failed_total",
    "Carrier acceptances recorded after the message was already FAILED and refunded.",
)
WEBHOOK_DELIVERIES = Counter(
    "smsgw_webhook_deliveries_total", "Tenant webhook attempts, by result.", ["result"]
)

# The queue gauges describe the whole database and only the API refreshes them
# at scrape time. They live in their own registry so that a worker, which
# serves only the default one, does not export them as a constant 0.
API_ONLY = CollectorRegistry()
QUEUE_DEPTH = Gauge("smsgw_queue_depth", "Messages waiting in status QUEUED.", registry=API_ONLY)
IN_FLIGHT = Gauge("smsgw_submits_in_flight", "Submit attempts without a recorded outcome.", registry=API_ONLY)
