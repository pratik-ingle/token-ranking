import { isValidTimeZone } from "@tokenrank/shared";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { rowsOf } from "@/db/client";
import { dailyUsage, ingestTokens, passkeys, users } from "@/db/schema";
import { refreshViews } from "@/db/views";
import { recoveryEmailHmac } from "./crypto";
import { ApiError } from "./http";
import { listIntegrations } from "./integrations";

/**
 * Hard-deletes the account and everything attached to it in one statement
 * (every table references users with ON DELETE CASCADE), then refreshes the
 * leaderboard views in the same request so no derived copy survives.
 */
export async function deleteAccount(db: Db, userId: string): Promise<void> {
  await db.delete(users).where(eq(users.id, userId));
  await refreshViews(db);
}

/** Validates a timezone in both ICU (JS) and the database's tz database. */
export async function assertTimeZone(db: Db, tz: string): Promise<void> {
  if (!isValidTimeZone(tz)) throw new ApiError(400, "invalid_timezone", "Unknown timezone.");
  try {
    await db.execute(sql`SELECT now() AT TIME ZONE ${tz}`);
  } catch {
    throw new ApiError(400, "invalid_timezone", "Timezone not supported by the database.");
  }
}

export async function updateSettings(
  db: Db,
  userId: string,
  patch: { visibility?: "public" | "hidden"; timezone?: string },
): Promise<void> {
  if (patch.timezone) await assertTimeZone(db, patch.timezone);
  const set: Partial<typeof users.$inferInsert> = {};
  if (patch.visibility) set.visibility = patch.visibility;
  if (patch.timezone) set.timezone = patch.timezone;
  if (Object.keys(set).length) await db.update(users).set(set).where(eq(users.id, userId));
}

export function validateEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Stores only an HMAC of the email, so we can match it on recovery but never display or mail it unprompted. */
export async function setRecoveryEmail(db: Db, userId: string, email: string | null): Promise<void> {
  if (email !== null && !validateEmail(email)) throw new ApiError(400, "invalid_email", "That doesn't look like an email address.");
  await db.update(users).set({ recoveryEmailHmac: email ? recoveryEmailHmac(email) : null }).where(eq(users.id, userId));
}

/** Everything we hold about a user, as JSON (credentials and hashes excluded). */
export async function exportAccount(db: Db, userId: string) {
  const user = (await db.select({
    username: users.username,
    visibility: users.visibility,
    timezone: users.timezone,
    created_at: users.createdAt,
    has_password: sql<boolean>`${users.passwordHash} IS NOT NULL`,
    has_recovery_email: sql<boolean>`${users.recoveryEmailHmac} IS NOT NULL`,
  }).from(users).where(eq(users.id, userId)).limit(1))[0];
  const usage = rowsOf(
    await db.execute(sql`
      SELECT date::text, source, model, category, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
             request_count, image_count, trust_level, flagged, updated_at
      FROM daily_usage WHERE user_id = ${userId} ORDER BY date, source, model, category`),
  ).map((r) => {
    const row = r as Record<string, unknown>;
    for (const k of ["input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "request_count", "image_count"]) row[k] = Number(row[k]);
    return row;
  });
  const tokens = await db
    .select({ name: ingestTokens.name, prefix: ingestTokens.tokenPrefix, scopes: ingestTokens.scopes, created_at: ingestTokens.createdAt, last_used_at: ingestTokens.lastUsedAt, revoked_at: ingestTokens.revokedAt })
    .from(ingestTokens)
    .where(eq(ingestTokens.userId, userId));
  const keys = await db.select({ created_at: passkeys.createdAt, last_used_at: passkeys.lastUsedAt, backed_up: passkeys.backedUp }).from(passkeys).where(eq(passkeys.userId, userId));
  return {
    exported_at: new Date().toISOString(),
    note: "This is everything TokenRank stores about you. Prompts, responses, emails and provider org ids are never stored.",
    account: user,
    integrations: await listIntegrations(db, userId),
    ingest_tokens: tokens,
    passkeys: keys,
    daily_usage: usage,
  };
}

export async function countUsageRows(db: Db, userId: string): Promise<number> {
  const r = await db.select({ n: sql<number>`count(*)::int` }).from(dailyUsage).where(eq(dailyUsage.userId, userId));
  return Number(r[0]?.n ?? 0);
}
