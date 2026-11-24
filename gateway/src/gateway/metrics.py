"""Prometheus metrics. The API serves them at /metrics; a worker serves them on
METRICS_PORT when that is set. Counters are per process."""

from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram

MESSAGES_ACCEPTED = Counter("smsgw_messages_accepted_total", "Messages accepted by the API.", ["tenant"])
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
WEBHOOK_DELIVERIES = Counter(
    "smsgw_webhook_deliveries_total", "Tenant webhook attempts, by result.", ["result"]
)
QUEUE_DEPTH = Gauge("smsgw_queue_depth", "Messages waiting in status QUEUED.")
IN_FLIGHT = Gauge("smsgw_submits_in_flight", "Submit attempts without a recorded outcome.")
