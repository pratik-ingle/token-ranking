import { CATEGORIES, SOURCES, TRUST_LEVELS, VISIBILITIES } from "@tokenrank/shared";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/*
 * Data minimisation is enforced here: there is no column for prompts,
 * completions, real names, emails (only an HMAC used for recovery lookup),
 * IP addresses, user agents, org ids (only an HMAC fingerprint) or billing.
 */

export const visibilityEnum = pgEnum("visibility", VISIBILITIES);
export const sourceEnum = pgEnum("usage_source", SOURCES);
export const categoryEnum = pgEnum("usage_category", CATEGORIES);
export const trustLevelEnum = pgEnum("trust_level", TRUST_LEVELS);
export const integrationModeEnum = pgEnum("integration_mode", ["local", "cloud", "upload"]);
export const integrationStatusEnum = pgEnum("integration_status", ["active", "error", "revoked", "duplicate"]);
export const deviceCodeStatusEnum = pgEnum("device_code_status", ["pending", "approved", "denied", "consumed"]);
export const reviewDecisionEnum = pgEnum("review_decision", ["approved", "rejected"]);

const counter = (name: string) => bigint(name, { mode: "number" }).notNull().default(0);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash"),
  /** HMAC-SHA256 of the normalised recovery email. The address itself is never stored. */
  recoveryEmailHmac: text("recovery_email_hmac"),
  /** Random opaque WebAuthn user handle (not the username). */
  webauthnUserId: text("webauthn_user_id").notNull().unique(),
  visibility: visibilityEnum("visibility").notNull().default("public"),
  timezone: text("timezone").notNull().default("UTC"),
  createdAt: createdAt(),
}, (t) => [index("users_recovery_email_idx").on(t.recoveryEmailHmac)]);

export const passkeys = pgTable("passkeys", {
  /** Credential id, base64url. */
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  publicKey: text("public_key").notNull(),
  counter: bigint("counter", { mode: "number" }).notNull().default(0),
  transports: text("transports"),
  deviceType: text("device_type"),
  backedUp: boolean("backed_up").notNull().default(false),
  createdAt: createdAt(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
}, (t) => [index("passkeys_user_idx").on(t.userId)]);

/** Sessions store only a hash of the cookie token — no IP, no user agent. */
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const ingestTokens = pgTable("ingest_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  tokenPrefix: text("token_prefix").notNull(),
  scopes: text("scopes").array().notNull().default(sql`ARRAY['ingest','read']::text[]`),
  createdAt: createdAt(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [index("ingest_tokens_user_idx").on(t.userId)]);

/** RFC 8628 device authorization for the CLI and MCP server. */
export const deviceCodes = pgTable("device_codes", {
  deviceCodeHash: text("device_code_hash").primaryKey(),
  userCode: text("user_code").notNull().unique(),
  client: text("client").notNull(),
  status: deviceCodeStatusEnum("status").notNull().default("pending"),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
});

export const recoveryTokens = pgTable("recovery_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

export const integrations = pgTable("integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  source: sourceEnum("source").notNull(),
  mode: integrationModeEnum("mode").notNull(),
  /** Envelope-encrypted provider credential (cloud mode only). Never returned to clients. */
  encryptedCredentials: text("encrypted_credentials"),
  /** HMAC-SHA256(server secret, sha256(source:org_id)). The org id itself is discarded. */
  orgFingerprintHmac: text("org_fingerprint_hmac"),
  status: integrationStatusEnum("status").notNull().default("active"),
  /** Short, secret-free status message (e.g. "HTTP 401"). */
  statusDetail: text("status_detail"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("integrations_user_source_mode_idx").on(t.userId, t.source, t.mode),
  index("integrations_fingerprint_idx").on(t.orgFingerprintHmac),
]);

/** Per-user data encryption key, wrapped by the master key (KMS / env secret). */
export const userKeys = pgTable("user_keys", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  wrappedDataKey: text("wrapped_data_key").notNull(),
  kekVersion: integer("kek_version").notNull().default(1),
  createdAt: createdAt(),
});

/**
 * The only usage data we keep: one aggregated row per user, local date,
 * source, model and category. Upserts replace values (idempotent re-sync).
 */
export const dailyUsage = pgTable("daily_usage", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  date: date("date", { mode: "string" }).notNull(),
  source: sourceEnum("source").notNull(),
  model: text("model").notNull(),
  category: categoryEnum("category").notNull(),
  inputTokens: counter("input_tokens"),
  outputTokens: counter("output_tokens"),
  cacheReadTokens: counter("cache_read_tokens"),
  cacheWriteTokens: counter("cache_write_tokens"),
  requestCount: counter("request_count"),
  imageCount: counter("image_count"),
  trustLevel: trustLevelEnum("trust_level").notNull(),
  /** Over a per-source daily sanity limit: kept, but excluded from rankings until reviewed. */
  flagged: boolean("flagged").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.date, t.source, t.model, t.category] }),
  index("daily_usage_date_idx").on(t.date),
  index("daily_usage_flagged_idx").on(t.flagged).where(sql`${t.flagged}`),
]);

/** Moderator decisions on flagged (user, date, source) days. */
export const usageReviews = pgTable("usage_reviews", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  date: date("date", { mode: "string" }).notNull(),
  source: sourceEnum("source").notNull(),
  decision: reviewDecisionEnum("decision").notNull(),
  /** Approval covers totals up to this value; a higher re-sync is flagged again. */
  approvedTotal: bigint("approved_total", { mode: "number" }).notNull().default(0),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.date, t.source] })]);

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
