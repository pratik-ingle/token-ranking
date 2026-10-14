import type {
  DeviceCodeResponse,
  DeviceTokenResponse,
  IngestResponse,
  MeRankResponse,
  Source,
  UsageRow,
  UserStatsResponse,
} from "@tokenrank/shared";
import { version } from "../package.json";

export const USER_AGENT = `tokenrank-collector/${version} (node ${process.version}; ${process.platform})`;

export const LOGIN_HINT = "Run `npx tokenrank-collector login` to sign in.";

export type ApiErrorCode =
  | "not_logged_in"
  | "unauthorized"
  | "invalid_payload"
  | "payload_too_large"
  | "rate_limited"
  | "server_error"
  | "network_error"
  | "bad_response"
  | "http_error";

/**
 * Every failure talking to the TokenRank server. Messages never contain the
 * token or request bodies, so they are safe to print.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: ApiErrorCode,
    readonly status: number | null,
    readonly details: { error?: string; issues?: Array<{ path: string; message: string }>; retryAfterSec?: number } = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class NotLoggedInError extends ApiError {
  constructor() {
    super(`Not logged in to TokenRank. ${LOGIN_HINT}`, "not_logged_in", null);
    this.name = "NotLoggedInError";
  }
}

export function isAuthError(err: unknown): boolean {
  return err instanceof ApiError && (err.code === "unauthorized" || err.code === "not_logged_in");
}

export interface MeResponse {
  username: string;
  timezone: string;
  visibility: string;
  profile_url: string;
}

export type DeviceTokenError = "authorization_pending" | "slow_down" | "expired_token" | "access_denied" | "invalid_grant";

export type DeviceTokenResult = { ok: true; token: DeviceTokenResponse } | { ok: false; error: DeviceTokenError | string };

export interface HeartbeatBody {
  source: Source;
  org_fingerprint?: string;
  status: "ok" | "error";
}

export interface HeartbeatResponse {
  status: "active" | "duplicate";
}

export interface ApiClientOptions {
  server: string;
  token?: string;
  fetch?: typeof fetch;
  /** Retries for 429 / 5xx / network errors (default 4). */
  maxRetries?: number;
  baseDelayMs?: number;
  /** Upper bound on any single wait, including Retry-After (default 120 s). */
  maxDelayMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  userAgent?: string;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function parseRetryAfter(value: string | null, nowMs: number): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return secs;
  const at = Date.parse(value);
  if (Number.isFinite(at)) return Math.max(0, (at - nowMs) / 1000);
  return undefined;
}

function short(s: unknown, max = 200): string | undefined {
  if (typeof s !== "string") return undefined;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Typed client for the TokenRank HTTP API (v1). */
export class TokenRankClient {
  readonly server: string;
  private readonly token: string | undefined;
  private readonly doFetch: typeof fetch;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly userAgent: string;

  constructor(opts: ApiClientOptions) {
    this.server = opts.server.replace(/\/+$/, "");
    this.token = opts.token;
    this.doFetch = opts.fetch ?? globalThis.fetch;
    this.maxRetries = opts.maxRetries ?? 4;
    this.baseDelayMs = opts.baseDelayMs ?? 1000;
    this.maxDelayMs = opts.maxDelayMs ?? 120_000;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.sleep = opts.sleep ?? defaultSleep;
    this.userAgent = opts.userAgent ?? USER_AGENT;
  }

  get hasToken(): boolean {
    return !!this.token;
  }

  // -- device flow (no token) ------------------------------------------------

  deviceCode(client: "collector" | "mcp" = "collector"): Promise<DeviceCodeResponse> {
    return this.request<DeviceCodeResponse>("POST", "/api/v1/device/code", { body: { client }, auth: false });
  }

  async deviceToken(deviceCode: string): Promise<DeviceTokenResult> {
    const res = await this.raw("POST", "/api/v1/device/token", { body: { device_code: deviceCode }, auth: false });
    const body = await this.readJson(res);
    if (res.ok) {
      const t = body as DeviceTokenResponse | null;
      if (!t || typeof t.access_token !== "string") throw new ApiError("Server returned an invalid token response", "bad_response", res.status);
      return { ok: true, token: t };
    }
    const error = (body as { error?: unknown } | null)?.error;
    if (res.status === 400 && typeof error === "string") return { ok: false, error };
    throw this.errorFor(res, body);
  }

  // -- authenticated ---------------------------------------------------------

  uploadUsage(rows: readonly UsageRow[]): Promise<IngestResponse> {
    return this.request<IngestResponse>("POST", "/api/v1/usage", { body: rows, auth: true });
  }

  heartbeat(body: HeartbeatBody): Promise<HeartbeatResponse> {
    return this.request<HeartbeatResponse>("POST", "/api/v1/integrations/heartbeat", { body, auth: true });
  }

  me(): Promise<MeResponse> {
    return this.request<MeResponse>("GET", "/api/v1/me", { auth: true });
  }

  meRank(includeCache = true): Promise<MeRankResponse> {
    return this.request<MeRankResponse>("GET", `/api/v1/me/rank?cache=${includeCache ? "true" : "false"}`, { auth: true });
  }

  meStats(): Promise<UserStatsResponse> {
    return this.request<UserStatsResponse>("GET", "/api/v1/me/stats", { auth: true });
  }

  // -- plumbing --------------------------------------------------------------

  private async request<T>(method: "GET" | "POST", path: string, opts: { body?: unknown; auth: boolean }): Promise<T> {
    const res = await this.raw(method, path, opts);
    const body = await this.readJson(res);
    if (!res.ok) throw this.errorFor(res, body);
    if (body === null) throw new ApiError(`Unexpected empty response from ${path}`, "bad_response", res.status);
    return body as T;
  }

  /** Performs the request with retries on 429 / 5xx / network errors. */
  private async raw(method: "GET" | "POST", path: string, opts: { body?: unknown; auth: boolean }): Promise<Response> {
    if (opts.auth && !this.token) throw new ApiError(`Not logged in to TokenRank. ${LOGIN_HINT}`, "not_logged_in", null);
    const headers: Record<string, string> = { Accept: "application/json", "User-Agent": this.userAgent };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.auth && this.token) headers.Authorization = `Bearer ${this.token}`;
    const url = `${this.server}${path}`;
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.doFetch(url, {
          method,
          headers,
          body: payload,
          signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(this.timeoutMs) : undefined,
        });
      } catch (err) {
        if (attempt >= this.maxRetries) {
          throw new ApiError(`Could not reach ${this.server} (${(err as Error).message})`, "network_error", null);
        }
        await this.sleep(this.backoff(attempt));
        continue;
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= this.maxRetries) return res;
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"), Date.now());
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      await this.sleep(retryAfter !== undefined ? Math.min(this.maxDelayMs, retryAfter * 1000) : this.backoff(attempt));
    }
  }

  private backoff(attempt: number): number {
    const exp = this.baseDelayMs * 2 ** attempt;
    return Math.min(this.maxDelayMs, exp + Math.floor(Math.random() * this.baseDelayMs * 0.25));
  }

  private async readJson(res: Response): Promise<unknown> {
    const text = await res.text().catch(() => "");
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      if (res.ok) throw new ApiError("Server returned invalid JSON", "bad_response", res.status);
      return null;
    }
  }

  private errorFor(res: Response, body: unknown): ApiError {
    const b = (body ?? {}) as { error?: unknown; message?: unknown; issues?: unknown };
    const error = short(b.error) ?? short(b.message);
    const status = res.status;
    if (status === 401) {
      return new ApiError(
        `The TokenRank server rejected your token (HTTP 401). It may have been revoked or expired. ${LOGIN_HINT.replace("to sign in", "again")}`,
        "unauthorized",
        status,
        { error },
      );
    }
    if (status === 400 && error === "invalid_payload") {
      const issues = Array.isArray(b.issues)
        ? b.issues.slice(0, 20).map((i) => ({ path: String((i as { path?: unknown }).path ?? ""), message: short((i as { message?: unknown }).message) ?? "" }))
        : [];
      const first = issues[0];
      return new ApiError(
        `The server rejected the upload as invalid${first ? ` (${first.path}: ${first.message})` : ""}`,
        "invalid_payload",
        status,
        { error, issues },
      );
    }
    if (status === 413) return new ApiError("Upload too large (HTTP 413)", "payload_too_large", status, { error });
    if (status === 429) {
      const retryAfterSec = parseRetryAfter(res.headers.get("retry-after"), Date.now());
      return new ApiError(
        `Rate limited by the TokenRank server (HTTP 429)${retryAfterSec !== undefined ? `; retry after ${Math.ceil(retryAfterSec)}s` : ""}`,
        "rate_limited",
        status,
        { error, retryAfterSec },
      );
    }
    if (status >= 500) return new ApiError(`TokenRank server error (HTTP ${status})${error ? `: ${error}` : ""}`, "server_error", status, { error });
    return new ApiError(`TokenRank request failed (HTTP ${status})${error ? `: ${error}` : ""}`, "http_error", status, { error });
  }
}
