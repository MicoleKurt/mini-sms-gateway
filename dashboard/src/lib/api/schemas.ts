/**
 * Zod schemas for every response of the gateway's internal API and for the
 * events on its stream. The shapes follow docs/API.md, section "Internal API
 * (dashboard)". Every response is parsed with these before the UI uses it.
 */
import { z } from "zod";
import { MESSAGE_STATUSES } from "@/lib/status";

const timestamp = z.string().min(1);
const micros = z.number().int();
const count = z.number().int().nonnegative();

export const messageStatusSchema = z.enum(MESSAGE_STATUSES);
export const encodingSchema = z.enum(["GSM7", "UCS2"]);

export const statusCountsSchema = z.object({
  ACCEPTED: count,
  QUEUED: count,
  SUBMITTED: count,
  DELIVERED: count,
  UNDELIVERED: count,
  EXPIRED: count,
  FAILED: count,
});

// --- Errors -----------------------------------------------------------------

export const errorDetailSchema = z.object({
  field: z.string().optional(),
  code: z.string(),
  message: z.string(),
  index: z.number().int().optional(),
});

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(errorDetailSchema).optional(),
  }),
});

// --- Tenants ----------------------------------------------------------------

export const tenantSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  currency: z.string(),
  balance_micros: micros,
  opening_balance_micros: micros,
  callback_url: z.string().nullable(),
  api_key_prefix: z.string(),
  counts: statusCountsSchema,
  total_messages: count,
});

export const tenantsResponseSchema = z.object({ data: z.array(tenantSchema) });

// --- Messages ---------------------------------------------------------------

export const messageSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  tenant_name: z.string(),
  batch_id: z.string().nullable(),
  client_ref: z.string().nullable(),
  to: z.string(),
  from: z.string(),
  text: z.string(),
  encoding: encodingSchema,
  segments: z.number().int().positive(),
  cost_micros: micros,
  currency: z.string(),
  status: messageStatusSchema,
  attempts: count,
  ambiguous_attempts: count,
  carrier_id: z.string().nullable(),
  failure_reason: z.string().nullable(),
  created_at: timestamp,
  submitted_at: timestamp.nullable(),
  finalized_at: timestamp.nullable(),
});

export const messageListResponseSchema = z.object({
  data: z.array(messageSchema),
  next_cursor: z.string().nullable(),
});

export const statusEventSchema = z.object({
  id: z.number().int(),
  status: messageStatusSchema,
  occurred_at: timestamp,
  detail: z.record(z.string(), z.unknown()),
});

export const attemptOutcomeSchema = z.enum([
  "ACCEPTED",
  "RATE_LIMITED",
  "UNAVAILABLE",
  "REJECTED",
  "TIMEOUT",
  "ABANDONED",
]);

export const submitAttemptSchema = z.object({
  attempt_no: z.number().int().positive(),
  worker_id: z.string(),
  started_at: timestamp,
  finished_at: timestamp.nullable(),
  // null while the attempt is in flight.
  outcome: attemptOutcomeSchema.nullable(),
  http_status: z.number().int().nullable(),
  carrier_id: z.string().nullable(),
  error: z.string().nullable(),
});

export const dlrReceiptSchema = z.object({
  id: z.number().int(),
  carrier_id: z.string(),
  status: z.enum(["DELIVRD", "UNDELIV", "EXPIRED"]),
  carrier_timestamp: timestamp,
  received_at: timestamp,
  disposition: z.enum(["PENDING", "APPLIED", "IGNORED"]),
});

export const ledgerEntrySchema = z.object({
  id: z.number().int(),
  kind: z.enum(["CHARGE", "REFUND"]),
  // Signed as a debit: a charge is positive, a refund is negative.
  amount_micros: micros,
  balance_after_micros: micros,
  created_at: timestamp,
});

export const webhookDeliverySchema = z.object({
  id: z.string(),
  url: z.string(),
  status: z.enum(["PENDING", "DELIVERED", "DEAD"]),
  attempts: count,
  last_http_status: z.number().int().nullable(),
  last_error: z.string().nullable(),
  created_at: timestamp,
  delivered_at: timestamp.nullable(),
  next_attempt_at: timestamp.nullable(),
});

export const messageDetailSchema = z.object({
  message: messageSchema,
  events: z.array(statusEventSchema),
  attempts: z.array(submitAttemptSchema),
  dlrs: z.array(dlrReceiptSchema),
  ledger: z.array(ledgerEntrySchema),
  webhooks: z.array(webhookDeliverySchema),
});

/** Response of POST /internal/tenants/{id}/messages (same as POST /v1/messages). */
export const acceptedMessageSchema = z.object({
  id: z.string(),
  status: messageStatusSchema,
  to: z.string(),
  from: z.string(),
  client_ref: z.string().nullable(),
  encoding: encodingSchema,
  segments: z.number().int().positive(),
  cost_micros: micros,
  currency: z.string(),
  created_at: timestamp,
});

// --- Prices -----------------------------------------------------------------

export const priceSchema = z.object({
  prefix: z.string(),
  country: z.string(),
  price_per_segment_micros: micros,
});

export const pricesResponseSchema = z.object({ data: z.array(priceSchema) });

// --- Overview ---------------------------------------------------------------

export const queueSchema = z.object({
  depth: count,
  oldest_age_ms: z.number().nonnegative(),
  in_flight: count,
});

export const throughputPointSchema = z.object({
  t: timestamp,
  submitted: z.number().nonnegative(),
  finalized: z.number().nonnegative(),
});

export const overviewSchema = z.object({
  queue: queueSchema,
  carrier: z.object({
    limit_per_second: z.number().positive(),
    target_per_second: z.number().nonnegative(),
  }),
  throughput: z.array(throughputPointSchema),
  billing: z.array(
    z.object({
      tenant_id: z.string(),
      consistent: z.boolean(),
      double_charged: count,
    }),
  ),
  webhooks: z.object({ pending: count, delivered: count, dead: count }),
});

// --- Stream events ----------------------------------------------------------

export const messageEventSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  status: messageStatusSchema,
  occurred_at: timestamp,
  message: messageSchema,
});

export const batchEventSchema = z.object({
  batch_id: z.string(),
  tenant_id: z.string(),
  count: count,
  occurred_at: timestamp,
});

export const statsEventSchema = z.object({
  at: timestamp,
  tenants: z.array(
    z.object({
      id: z.string(),
      balance_micros: micros,
      counts: statusCountsSchema,
      total_messages: count,
    }),
  ),
  queue: queueSchema,
  rate: z.object({
    submitted_per_second: z.number().nonnegative(),
    finalized_per_second: z.number().nonnegative(),
  }),
});

// --- Types ------------------------------------------------------------------

export type ErrorDetail = z.infer<typeof errorDetailSchema>;
export type Tenant = z.infer<typeof tenantSchema>;
export type Message = z.infer<typeof messageSchema>;
export type MessageListResponse = z.infer<typeof messageListResponseSchema>;
export type StatusEvent = z.infer<typeof statusEventSchema>;
export type AttemptOutcome = z.infer<typeof attemptOutcomeSchema>;
export type SubmitAttempt = z.infer<typeof submitAttemptSchema>;
export type DlrReceipt = z.infer<typeof dlrReceiptSchema>;
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;
export type MessageDetail = z.infer<typeof messageDetailSchema>;
export type AcceptedMessage = z.infer<typeof acceptedMessageSchema>;
export type Price = z.infer<typeof priceSchema>;
export type Queue = z.infer<typeof queueSchema>;
export type ThroughputPoint = z.infer<typeof throughputPointSchema>;
export type Overview = z.infer<typeof overviewSchema>;
export type MessageEvent = z.infer<typeof messageEventSchema>;
export type BatchEvent = z.infer<typeof batchEventSchema>;
export type StatsEvent = z.infer<typeof statsEventSchema>;
