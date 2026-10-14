import { DEFAULT_ACTIVE_DAY_MIN_TOKENS, DEFAULT_IMAGE_SANITY_LIMIT, DEFAULT_SANITY_LIMITS, SOURCES, type Source } from "@tokenrank/shared";

/**
 * Server configuration. In development every secret has a fallback so the
 * app boots after `pnpm setup:env`; in production missing secrets are fatal.
 */
const isProd = process.env.NODE_ENV === "production";

function required(name: string, devFallback: string): string {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  if (isProd) throw new Error(`Missing required environment variable ${name}`);
  return devFallback;
}

function parseSanityLimits(): Record<Source, number> {
  const limits = { ...DEFAULT_SANITY_LIMITS };
  const raw = process.env.SANITY_LIMITS_JSON;
  if (!raw) return limits;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const s of SOURCES) {
      const v = parsed[s];
      if (typeof v === "number" && v > 0) limits[s] = v;
    }
  } catch {
    // ignore malformed overrides; defaults stay in force
  }
  return limits;
}

export const env = {
  get isProd() {
    return isProd;
  },
  get appOrigin(): string {
    return (process.env.APP_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
  },
  get rpId(): string {
    return process.env.WEBAUTHN_RP_ID ?? new URL(this.appOrigin).hostname;
  },
  get rpName(): string {
    return process.env.WEBAUTHN_RP_NAME ?? "TokenRank";
  },
  /** Root secret for HMACs (org fingerprints, email lookup, signed cookies). */
  get serverSecret(): string {
    return required("SERVER_SECRET", "dev-only-insecure-server-secret-change-me");
  },
  /** Base64 32-byte key-encryption key for envelope encryption (local KMS). */
  get masterKey(): string {
    return required("MASTER_KEY", "ZGV2LW9ubHktaW5zZWN1cmUtbWFzdGVyLWtleS0zMmI=");
  },
  get cronSecret(): string | null {
    return process.env.CRON_SECRET || null;
  },
  get adminUsernames(): Set<string> {
    return new Set((process.env.ADMIN_USERNAMES ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
  },
  get smtpUrl(): string | null {
    return process.env.SMTP_URL || null;
  },
  get mailFrom(): string {
    return process.env.MAIL_FROM ?? "TokenRank <no-reply@localhost>";
  },
  get activeDayMinTokens(): number {
    const v = Number(process.env.ACTIVE_DAY_MIN_TOKENS);
    return Number.isFinite(v) && v >= 1 ? Math.floor(v) : DEFAULT_ACTIVE_DAY_MIN_TOKENS;
  },
  get sanityLimits(): Record<Source, number> {
    return parseSanityLimits();
  },
  get imageSanityLimit(): number {
    const v = Number(process.env.IMAGE_SANITY_LIMIT);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_IMAGE_SANITY_LIMIT;
  },
  /** Trust X-Forwarded-For for rate limiting (only behind a proxy you control). */
  get trustProxy(): boolean {
    return process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true";
  },
};
