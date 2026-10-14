/**
 * Logging hygiene: we log events with a small set of whitelisted, non-sensitive
 * fields. Never request bodies, headers, cookies, tokens, keys, emails or IPs.
 * As a second line of defence, every string is scrubbed for secret-looking
 * substrings before it is written.
 */

const ALLOWED_FIELDS = new Set([
  "route", "method", "status", "ms", "rows", "inserted", "updated", "flagged", "skipped",
  "source", "window", "count", "error", "views", "integrations", "ok", "failed", "job",
]);

const SECRET_PATTERNS: RegExp[] = [
  /\btr_[A-Za-z0-9_-]{8,}/g, // TokenRank ingest tokens
  /\bsk-[A-Za-z0-9_-]{8,}/g, // OpenAI / Anthropic keys (sk-..., sk-ant-..., sk-admin-...)
  /\bcrsr_[A-Za-z0-9_-]{8,}/g, // Cursor keys
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bBasic\s+[A-Za-z0-9+/=]+/gi,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, // emails
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, // IPv4
];

export function scrub(value: string): string {
  let out = value;
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[redacted]");
  return out.length > 300 ? `${out.slice(0, 300)}…` : out;
}

type Fields = Record<string, string | number | boolean | null | undefined>;

function emit(level: "info" | "warn" | "error", event: string, fields: Fields = {}): void {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!ALLOWED_FIELDS.has(k) || v === undefined) continue;
    safe[k] = typeof v === "string" ? scrub(v) : v;
  }
  const line = JSON.stringify({ t: new Date().toISOString(), level, event: scrub(event), ...safe });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: Fields) => emit("info", event, fields),
  warn: (event: string, fields?: Fields) => emit("warn", event, fields),
  error: (event: string, fields?: Fields) => emit("error", event, fields),
};

/** Error summary safe for logs: class name + scrubbed message, no stack, no cause. */
export function errorSummary(err: unknown): string {
  if (err instanceof Error) return scrub(`${err.name}: ${err.message}`);
  return "unknown error";
}
