/**
 * In-memory fixed-window rate limiter. Keys (IP addresses, token ids) live
 * only in process memory and expire with their window; they are never
 * persisted or logged. For multi-instance deployments, put a shared limiter
 * (e.g. at the edge / reverse proxy) in front as well.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

function sweep(now: number): void {
  if (now - lastSweep < 30_000) return;
  lastSweep = now;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  sweep(now);
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count++;
  const ok = b.count <= limit;
  return { ok, remaining: Math.max(0, limit - b.count), retryAfterSeconds: ok ? 0 : Math.ceil((b.resetAt - now) / 1000) };
}

export function resetRateLimits(): void {
  buckets.clear();
}

export function rateLimitSize(): number {
  return buckets.size;
}

export const LIMITS = {
  ingestPerToken: { limit: 60, windowMs: 60_000 },
  ingestPerIp: { limit: 120, windowMs: 60_000 },
  otlpPerToken: { limit: 120, windowMs: 60_000 },
  auth: { limit: 10, windowMs: 60_000 },
  deviceCode: { limit: 10, windowMs: 60_000 },
  publicApi: { limit: 120, windowMs: 60_000 },
  account: { limit: 30, windowMs: 60_000 },
} as const;
