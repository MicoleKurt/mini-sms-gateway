/**
 * Server-side proxy to the gateway's internal API.
 *
 * /api/gateway/<path>?<query>  ->  ${GATEWAY_URL}/internal/<path>?<query>
 *
 * The admin token is added here, on the server, so it never reaches the
 * browser. The upstream body is passed on as a stream, which is what lets
 * Server-Sent Events from /internal/stream arrive without buffering.
 */
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const FORWARDED_REQUEST_HEADERS = ["accept", "content-type", "idempotency-key"];
const FORWARDED_RESPONSE_HEADERS = ["content-type", "idempotent-replay"];

function gatewayUrl(): string {
  return (process.env.GATEWAY_URL ?? "http://localhost:8000").replace(/\/+$/, "");
}

function adminToken(): string {
  return process.env.ADMIN_TOKEN ?? "dev-admin-token";
}

function unreachable(): Response {
  return Response.json(
    {
      error: {
        code: "GATEWAY_UNREACHABLE",
        message: "The dashboard server could not reach the gateway.",
      },
    },
    { status: 502 },
  );
}

async function forward(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  const target = `${gatewayUrl()}/internal/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;

  const headers = new Headers({ "X-Admin-Token": adminToken() });
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === "POST" ? await request.arrayBuffer() : undefined,
      cache: "no-store",
      // Aborts when the browser goes away, so a closed tab does not leave an
      // open stream to the gateway behind.
      signal: request.signal,
    });
  } catch {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return unreachable();
  }

  const responseHeaders = new Headers({
    // no-transform also keeps the Next.js server from compressing the body,
    // which would hold stream events back until a buffer fills.
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  });
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export { forward as GET, forward as POST };
