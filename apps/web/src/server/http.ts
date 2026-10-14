import { NextResponse, type NextRequest } from "next/server";
import { env } from "./env";
import { errorSummary, log } from "./logger";
import { rateLimit } from "./rate-limit";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
    readonly extra?: Record<string, unknown>,
    readonly headers?: Record<string, string>,
  ) {
    super(message ?? code);
    this.name = "ApiError";
  }
}

export function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): NextResponse {
  return NextResponse.json(body, {
    status: init.status ?? 200,
    headers: { "Cache-Control": "no-store", ...init.headers },
  });
}

/**
 * Client IP for rate limiting only. Held in memory by the limiter, never
 * stored or logged. X-Forwarded-For is trusted only with TRUST_PROXY=1.
 */
export function clientIp(req: Request): string {
  if (env.trustProxy) {
    const xff = req.headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0]!.trim();
    const real = req.headers.get("x-real-ip");
    if (real) return real.trim();
  }
  return "local";
}

export function enforceRateLimit(key: string, cfg: { limit: number; windowMs: number }): void {
  const r = rateLimit(key, cfg.limit, cfg.windowMs);
  if (!r.ok) {
    throw new ApiError(429, "rate_limited", "Too many requests, slow down.", undefined, {
      "Retry-After": String(r.retryAfterSeconds),
    });
  }
}

/** Reads a JSON body with a hard size cap, without ever logging it. */
export async function readJson(req: Request, maxBytes = 1_000_000): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) throw new ApiError(413, "payload_too_large", `Body exceeds ${maxBytes} bytes.`);
  const reader = req.body?.getReader();
  if (!reader) throw new ApiError(400, "invalid_json", "Request body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new ApiError(413, "payload_too_large", `Body exceeds ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "Body is not valid JSON.");
  }
}

/**
 * CSRF defence for cookie-authenticated mutations: the Origin header must
 * match our origin (cookies are also SameSite=Lax).
 */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (!origin) throw new ApiError(403, "bad_origin", "Missing Origin header.");
  const allowed = new Set([env.appOrigin, new URL(req.url).origin]);
  if (!allowed.has(origin)) throw new ApiError(403, "bad_origin", "Cross-origin request rejected.");
}

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response>;

/**
 * Wraps a route handler: maps ApiError to JSON, logs only route, method,
 * status and duration (never bodies, headers, tokens or IPs).
 */
export function api<C = unknown>(route: string, handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    const started = Date.now();
    let status = 500;
    try {
      const res = await handler(req, ctx);
      status = res.status;
      return res;
    } catch (err) {
      if (err instanceof ApiError) {
        status = err.status;
        return json({ error: err.code, message: err.message, ...err.extra }, { status: err.status, headers: err.headers });
      }
      log.error("unhandled_error", { route, method: req.method, error: errorSummary(err) });
      return json({ error: "internal_error", message: "Something went wrong." }, { status: 500 });
    } finally {
      if (status >= 500 || process.env.LOG_REQUESTS === "1") {
        log.info("request", { route, method: req.method, status, ms: Date.now() - started });
      }
    }
  };
}
