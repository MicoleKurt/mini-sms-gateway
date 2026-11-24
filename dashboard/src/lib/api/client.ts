import { z } from "zod";
import { errorResponseSchema, type ErrorDetail } from "./schemas";

/** Base path of the server-side proxy. The browser never calls the gateway itself. */
export const GATEWAY_PROXY_PATH = "/api/gateway";

/**
 * Any failed call. `status` is the HTTP status, or 0 when there was no HTTP
 * answer. `code` is the gateway's error code, or one of the client-side codes
 * NETWORK_ERROR and INVALID_RESPONSE.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ErrorDetail[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type QueryValue = string | number | null | undefined;

export function withQuery(path: string, params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ApiError(
      response.status,
      "INVALID_RESPONSE",
      `The server answered ${response.status} with a body that is not JSON.`,
    );
  }
}

function errorFromBody(status: number, body: unknown): ApiError {
  const parsed = errorResponseSchema.safeParse(body);
  if (!parsed.success) {
    return new ApiError(
      status,
      "INVALID_RESPONSE",
      `The server answered ${status} without an error body.`,
    );
  }
  const { code, message, details } = parsed.data.error;
  return new ApiError(status, code, message, details);
}

/**
 * Call the gateway through the proxy and parse the answer with `schema`.
 * A body that does not match the schema is an error, never a partial result.
 */
export async function gatewayFetch<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  init?: RequestInit,
): Promise<z.infer<Schema>> {
  let response: Response;
  try {
    response = await fetch(`${GATEWAY_PROXY_PATH}/${path}`, {
      ...init,
      headers: { Accept: "application/json", ...init?.headers },
    });
  } catch (cause) {
    // An aborted request is a cancellation, not a failure to report.
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError(0, "NETWORK_ERROR", "Could not reach the dashboard server.");
  }

  const body = await readJson(response);
  if (!response.ok) throw errorFromBody(response.status, body);

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(
      response.status,
      "INVALID_RESPONSE",
      `The gateway sent data in an unexpected shape for /${path.split("?")[0]}. ${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

/** A short sentence for an error state or a toast. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
