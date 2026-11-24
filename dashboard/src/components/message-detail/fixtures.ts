import type { MessageDetail } from "@/lib/api/schemas";

/**
 * A real record from the gateway: delivered on the second submit attempt
 * after the carrier answered the first with HTTP 503. Tests derive the
 * other states from it.
 */
export const deliveredOnRetry: MessageDetail = {
  message: {
    id: "01a20e47-242d-7847-a122-b0f8ee4d317f",
    tenant_id: "t-acme",
    tenant_name: "Acme Bank",
    batch_id: null,
    client_ref: "load-b5a23c9e-otp-238",
    to: "+971506701448",
    from: "ACME",
    text: "Your Acme Bank code is 619835",
    encoding: "GSM7",
    segments: 1,
    cost_micros: 21_000,
    currency: "USD",
    status: "DELIVERED",
    attempts: 2,
    ambiguous_attempts: 0,
    carrier_id: "c-cd6580d9ecb044b4b4e77f7e600f796b",
    failure_reason: null,
    created_at: "2026-11-24T15:57:53.070100Z",
    submitted_at: "2026-11-24T15:57:53.850778Z",
    finalized_at: "2026-11-24T15:58:02.244420Z",
  },
  events: [
    { id: 81654, status: "ACCEPTED", occurred_at: "2026-11-24T15:57:53.070100Z", detail: {} },
    { id: 81655, status: "QUEUED", occurred_at: "2026-11-24T15:57:53.071282Z", detail: {} },
    {
      id: 81675,
      status: "SUBMITTED",
      occurred_at: "2026-11-24T15:57:53.850997Z",
      detail: { attempt: 2, carrier_id: "c-cd6580d9ecb044b4b4e77f7e600f796b" },
    },
    {
      id: 81710,
      status: "DELIVERED",
      occurred_at: "2026-11-24T15:58:02.244650Z",
      detail: {
        carrier_id: "c-cd6580d9ecb044b4b4e77f7e600f796b",
        dlr_status: "DELIVRD",
        carrier_timestamp: "2026-11-24T15:58:02.240788Z",
      },
    },
  ],
  attempts: [
    {
      attempt_no: 1,
      worker_id: "w-72a97779",
      started_at: "2026-11-24T15:57:53.111993Z",
      finished_at: "2026-11-24T15:57:53.244502Z",
      outcome: "UNAVAILABLE",
      http_status: 503,
      carrier_id: null,
      error: "TEMPORARY_FAILURE",
    },
    {
      attempt_no: 2,
      worker_id: "w-72a97779",
      started_at: "2026-11-24T15:57:53.547412Z",
      finished_at: "2026-11-24T15:57:53.850552Z",
      outcome: "ACCEPTED",
      http_status: 200,
      carrier_id: "c-cd6580d9ecb044b4b4e77f7e600f796b",
      error: null,
    },
  ],
  dlrs: [
    {
      id: 22581,
      carrier_id: "c-cd6580d9ecb044b4b4e77f7e600f796b",
      status: "DELIVRD",
      carrier_timestamp: "2026-11-24T15:58:02.240788Z",
      received_at: "2026-11-24T15:58:02.244007Z",
      disposition: "APPLIED",
    },
  ],
  ledger: [
    {
      id: 20706,
      kind: "CHARGE",
      amount_micros: 21_000,
      balance_after_micros: 240_004_000,
      created_at: "2026-11-24T15:57:53.071465Z",
    },
  ],
  webhooks: [
    {
      id: "01a20e47-4803-779d-8707-b1b72e8794a2",
      url: "http://127.0.0.1:9100/hooks/acme-bank",
      status: "DELIVERED",
      attempts: 1,
      last_http_status: 200,
      last_error: null,
      created_at: "2026-11-24T15:58:02.245081Z",
      delivered_at: "2026-11-24T15:58:02.292109Z",
      next_attempt_at: "2026-11-24T15:58:32.278653Z",
    },
  ],
};

type MessageChanges = Partial<MessageDetail["message"]>;

/** The record with some fields of the message and of its lists replaced. */
export function withChanges(
  message: MessageChanges,
  lists: Partial<Omit<MessageDetail, "message">> = {},
): MessageDetail {
  return {
    ...deliveredOnRetry,
    ...lists,
    message: { ...deliveredOnRetry.message, ...message },
  };
}
