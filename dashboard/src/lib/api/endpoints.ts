/** One function per internal endpoint of the gateway (docs/API.md). */
import type { MessageStatus } from "@/lib/status";
import { gatewayFetch, withQuery } from "./client";
import {
  acceptedMessageSchema,
  messageDetailSchema,
  messageListResponseSchema,
  overviewSchema,
  pricesResponseSchema,
  tenantsResponseSchema,
} from "./schemas";

export interface MessageListParams {
  tenant_id?: string | null;
  status?: MessageStatus | null;
  created_from?: string | null;
  created_to?: string | null;
  q?: string | null;
  limit: number;
  cursor?: string | null;
}

export interface SendMessageInput {
  tenantId: string;
  idempotencyKey: string;
  body: { to: string; from: string; text: string; client_ref?: string };
}

export async function getTenants(signal?: AbortSignal) {
  return (await gatewayFetch("tenants", tenantsResponseSchema, { signal })).data;
}

export async function getPrices(signal?: AbortSignal) {
  return (await gatewayFetch("prices", pricesResponseSchema, { signal })).data;
}

export function getOverview(signal?: AbortSignal) {
  return gatewayFetch("overview", overviewSchema, { signal });
}

export function listMessages(params: MessageListParams, signal?: AbortSignal) {
  return gatewayFetch(withQuery("messages", { ...params }), messageListResponseSchema, { signal });
}

export function getMessageDetail(id: string, signal?: AbortSignal) {
  return gatewayFetch(`messages/${encodeURIComponent(id)}`, messageDetailSchema, { signal });
}

export function sendMessage({ tenantId, idempotencyKey, body }: SendMessageInput) {
  return gatewayFetch(`tenants/${encodeURIComponent(tenantId)}/messages`, acceptedMessageSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(body),
  });
}
