import { chunkRows, MAX_ROWS_PER_REQUEST, type Source } from "@tokenrank/shared";
import {
  createAnthropicIntegration,
  createCursorIntegration,
  createOpenAIIntegration,
  orgFingerprintInput,
  ProviderError,
  type UsageIntegration,
} from "@tokenrank/shared/providers";
import { and, eq, isNotNull, ne, or, sql, lt, isNull, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { rowsOf } from "@/db/client";
import { integrations, userKeys, users, dailyUsage } from "@/db/schema";
import { decryptCredential, encryptCredential, getKms, newDataKey, orgFingerprintHmac } from "./crypto";
import { ApiError } from "./http";
import { ingestRows } from "./ingest";
import { errorSummary, log } from "./logger";

export const CLOUD_SOURCES = ["openai_api", "anthropic_api", "cursor"] as const satisfies readonly Source[];
export type CloudSource = (typeof CLOUD_SOURCES)[number];
export const CLOUD_SYNC_INTERVAL_MS = 6 * 3600_000;
const FIRST_SYNC_DAYS = 90;

export interface CloudCredential {
  apiKey: string;
  /** Cursor only: filter team usage to this member (stored encrypted with the key). */
  email?: string;
  teamWide?: boolean;
}

// ---------------------------------------------------------------------------
// Org de-duplication
// ---------------------------------------------------------------------------

/**
 * Registers an org fingerprint for an integration. If another account already
 * claimed the same provider org, this integration is marked "duplicate" and
 * its usage for that source is excluded from rankings (counted only once).
 */
async function applyFingerprint(db: Db, integrationId: string, userId: string, fingerprint: string | null): Promise<"active" | "duplicate"> {
  if (!fingerprint) return "active";
  const others = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(and(eq(integrations.orgFingerprintHmac, fingerprint), ne(integrations.userId, userId), ne(integrations.status, "revoked"), ne(integrations.status, "duplicate")))
    .limit(1);
  const status = others.length > 0 ? "duplicate" : "active";
  await db
    .update(integrations)
    .set({
      orgFingerprintHmac: fingerprint,
      status,
      statusDetail: status === "duplicate" ? "This provider organization is already connected to another account, so it counts only once." : null,
    })
    .where(eq(integrations.id, integrationId));
  return status;
}

/** Called by the collector before uploading for a source. */
export async function heartbeat(
  db: Db,
  userId: string,
  body: { source: Source; org_fingerprint?: string; status: "ok" | "error" },
): Promise<{ status: "active" | "duplicate" }> {
  const [row] = await db
    .insert(integrations)
    .values({ userId, source: body.source, mode: "local", status: "active" })
    .onConflictDoUpdate({ target: [integrations.userId, integrations.source, integrations.mode], set: { source: sql`excluded.source` } })
    .returning({ id: integrations.id, status: integrations.status, fp: integrations.orgFingerprintHmac });
  const fp = body.org_fingerprint ? orgFingerprintHmac(body.org_fingerprint) : row!.fp;
  const status = await applyFingerprint(db, row!.id, userId, fp);
  if (body.status === "error") {
    await db.update(integrations).set({ status: status === "duplicate" ? "duplicate" : "error", statusDetail: status === "duplicate" ? undefined : "The collector reported an error for this source." }).where(eq(integrations.id, row!.id));
  }
  return { status };
}

// ---------------------------------------------------------------------------
// Envelope encryption: per-user data key wrapped by the master key
// ---------------------------------------------------------------------------

async function getOrCreateDataKey(db: Db, userId: string): Promise<Buffer> {
  const existing = (await db.select().from(userKeys).where(eq(userKeys.userId, userId)).limit(1))[0];
  if (existing) return getKms().unwrap(existing.wrappedDataKey);
  const dk = newDataKey();
  await db.insert(userKeys).values({ userId, wrappedDataKey: await getKms().wrap(dk) }).onConflictDoNothing();
  // Re-read in case of a concurrent insert.
  const row = (await db.select().from(userKeys).where(eq(userKeys.userId, userId)).limit(1))[0]!;
  return getKms().unwrap(row.wrappedDataKey);
}

const aadFor = (userId: string, source: string) => `tokenrank:cred:${userId}:${source}`;

function buildIntegration(source: CloudSource, cred: CloudCredential, timeZone: string, fetchImpl?: typeof fetch) {
  const common = { timeZone, trust: "verified" as const, fetch: fetchImpl, userAgent: "tokenrank-server" };
  switch (source) {
    case "openai_api":
      return createOpenAIIntegration({ ...common, adminKey: cred.apiKey });
    case "anthropic_api":
      return createAnthropicIntegration({ ...common, adminKey: cred.apiKey });
    case "cursor":
      return createCursorIntegration({ ...common, adminKey: cred.apiKey, email: cred.email, teamWide: cred.teamWide });
  }
}

/**
 * Validates a pasted admin key by calling the provider, stores it
 * envelope-encrypted, and records the org fingerprint. The key is never
 * logged and never returned to the client.
 */
export async function connectCloud(
  db: Db,
  user: { id: string; timezone: string },
  source: CloudSource,
  cred: CloudCredential,
  fetchImpl?: typeof fetch,
): Promise<{ id: string; status: "active" | "duplicate" }> {
  let integ: ReturnType<typeof buildIntegration>;
  try {
    integ = buildIntegration(source, cred, user.timezone, fetchImpl);
  } catch (e) {
    throw new ApiError(400, "invalid_credential", (e as Error).message);
  }
  let orgId: string | null = null;
  try {
    const withIdentity = integ as UsageIntegration & { identify?: () => Promise<{ orgId: string | null }> };
    if (withIdentity.identify) orgId = (await withIdentity.identify()).orgId;
    else await integ.fetchUsage(new Date(Date.now() - 86_400_000), new Date());
  } catch (e) {
    const msg = e instanceof ProviderError ? e.message : "Could not reach the provider.";
    throw new ApiError(400, "invalid_credential", `The provider rejected this key: ${msg}`);
  }
  const dk = await getOrCreateDataKey(db, user.id);
  const encrypted = encryptCredential(dk, cred, aadFor(user.id, source));
  const fingerprint = orgId ? orgFingerprintHmac(await orgFingerprintInput(source, orgId)) : null;
  orgId = null; // discard
  const [row] = await db
    .insert(integrations)
    .values({ userId: user.id, source, mode: "cloud", encryptedCredentials: encrypted, status: "active" })
    .onConflictDoUpdate({
      target: [integrations.userId, integrations.source, integrations.mode],
      set: { encryptedCredentials: encrypted, status: "active", statusDetail: null, lastSyncedAt: null },
    })
    .returning({ id: integrations.id });
  const status = await applyFingerprint(db, row!.id, user.id, fingerprint);
  return { id: row!.id, status };
}

/**
 * One-click revoke: deletes the stored credential. With deleteData, also
 * hard-deletes the verified usage that was synced from it. When the user has
 * no cloud credentials left, their data key is destroyed too (crypto-shred).
 */
export async function revokeCloud(db: Db, userId: string, source: CloudSource, deleteData: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(integrations).where(and(eq(integrations.userId, userId), eq(integrations.source, source), eq(integrations.mode, "cloud")));
    if (deleteData) {
      await tx.delete(dailyUsage).where(and(eq(dailyUsage.userId, userId), eq(dailyUsage.source, source), eq(dailyUsage.trustLevel, "verified")));
    }
    const remaining = await tx
      .select({ id: integrations.id })
      .from(integrations)
      .where(and(eq(integrations.userId, userId), eq(integrations.mode, "cloud"), isNotNull(integrations.encryptedCredentials)))
      .limit(1);
    if (remaining.length === 0) await tx.delete(userKeys).where(eq(userKeys.userId, userId));
  });
}

/** Removes a local/upload integration entry (data stays unless deleteData). */
export async function removeIntegration(db: Db, userId: string, integrationId: string, deleteData: boolean): Promise<boolean> {
  const row = (await db.select().from(integrations).where(and(eq(integrations.id, integrationId), eq(integrations.userId, userId))).limit(1))[0];
  if (!row) return false;
  if (row.mode === "cloud") {
    await revokeCloud(db, userId, row.source as CloudSource, deleteData);
    return true;
  }
  await db.transaction(async (tx) => {
    await tx.delete(integrations).where(eq(integrations.id, integrationId));
    if (deleteData) {
      await tx.delete(dailyUsage).where(and(eq(dailyUsage.userId, userId), eq(dailyUsage.source, row.source), eq(dailyUsage.trustLevel, "self_reported")));
    }
  });
  return true;
}

export async function runCloudSync(
  db: Db,
  integrationId: string,
  opts: { fetch?: typeof fetch; now?: Date } = {},
): Promise<{ ok: boolean; rows: number }> {
  const now = opts.now ?? new Date();
  const row = (
    await db
      .select({
        id: integrations.id,
        userId: integrations.userId,
        source: integrations.source,
        encrypted: integrations.encryptedCredentials,
        lastSyncedAt: integrations.lastSyncedAt,
        timezone: users.timezone,
      })
      .from(integrations)
      .innerJoin(users, eq(users.id, integrations.userId))
      .where(and(eq(integrations.id, integrationId), eq(integrations.mode, "cloud")))
      .limit(1)
  )[0];
  if (!row?.encrypted || !(CLOUD_SOURCES as readonly string[]).includes(row.source)) return { ok: false, rows: 0 };
  const source = row.source as CloudSource;
  try {
    const dk = await getOrCreateDataKey(db, row.userId);
    const cred = decryptCredential<CloudCredential>(dk, row.encrypted, aadFor(row.userId, source));
    const integ: UsageIntegration = buildIntegration(source, cred, row.timezone, opts.fetch);
    const since = row.lastSyncedAt
      ? new Date(row.lastSyncedAt.getTime() - 2 * 86_400_000)
      : new Date(now.getTime() - FIRST_SYNC_DAYS * 86_400_000);
    const rows = await integ.fetchUsage(since, now);
    for (const chunk of chunkRows(rows, MAX_ROWS_PER_REQUEST)) {
      await ingestRows(db, chunk, { userId: row.userId, timeZone: row.timezone, trust: "verified", mode: "cloud", now });
    }
    await db
      .update(integrations)
      .set({ lastSyncedAt: now, status: sql`CASE WHEN ${integrations.status} = 'duplicate' THEN 'duplicate'::integration_status ELSE 'active'::integration_status END`, statusDetail: sql`CASE WHEN ${integrations.status} = 'duplicate' THEN ${integrations.statusDetail} ELSE NULL END` })
      .where(eq(integrations.id, row.id));
    log.info("cloud_sync", { source, rows: rows.length, ok: true });
    return { ok: true, rows: rows.length };
  } catch (e) {
    const detail = e instanceof ProviderError ? `Sync failed: ${e.message}` : "Sync failed. We'll retry automatically.";
    await db.update(integrations).set({ status: "error", statusDetail: detail }).where(eq(integrations.id, row.id));
    log.warn("cloud_sync_failed", { source, error: errorSummary(e) });
    return { ok: false, rows: 0 };
  }
}

/** Integrations due for their 6-hourly sync. */
export async function dueCloudIntegrations(db: Db, now = new Date()): Promise<string[]> {
  const cutoff = new Date(now.getTime() - CLOUD_SYNC_INTERVAL_MS);
  const rows = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(
      and(
        eq(integrations.mode, "cloud"),
        isNotNull(integrations.encryptedCredentials),
        inArray(integrations.status, ["active", "error", "duplicate"]),
        or(isNull(integrations.lastSyncedAt), lt(integrations.lastSyncedAt, cutoff)),
      ),
    );
  return rows.map((r) => r.id);
}

export interface IntegrationView {
  id: string;
  source: Source;
  mode: "local" | "cloud" | "upload";
  status: string;
  status_detail: string | null;
  last_synced_at: string | null;
  has_credential: boolean;
}

/** Integration list for settings — never includes credentials or fingerprints. */
export async function listIntegrations(db: Db, userId: string): Promise<IntegrationView[]> {
  const rows = rowsOf<{ id: string; source: Source; mode: "local" | "cloud" | "upload"; status: string; status_detail: string | null; last_synced_at: string | Date | null; has_credential: boolean }>(
    await db.execute(sql`
      SELECT id, source, mode, status, status_detail, last_synced_at, (encrypted_credentials IS NOT NULL) AS has_credential
      FROM integrations WHERE user_id = ${userId} ORDER BY source, mode`),
  );
  return rows.map((r) => ({ ...r, last_synced_at: r.last_synced_at ? new Date(r.last_synced_at).toISOString() : null }));
}
