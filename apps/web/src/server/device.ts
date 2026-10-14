import type { DeviceCodeResponse, DeviceTokenResponse } from "@tokenrank/shared";
import { randomInt } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { deviceCodes, users } from "@/db/schema";
import { randomToken, sha256Hex } from "./crypto";
import { env } from "./env";
import { createIngestToken } from "./tokens";

/**
 * OAuth 2.0 Device Authorization Grant (RFC 8628) for the CLI and the MCP
 * server: the CLI shows a short code, the user approves it in the browser
 * while signed in, and the CLI receives a personal ingest token.
 */
export const DEVICE_CODE_TTL_S = 600;
export const DEVICE_POLL_INTERVAL_S = 5;
// No vowels: codes can't spell words. 20^8 ≈ 2.56e10 combinations.
const ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
export const DEVICE_CLIENTS = ["collector", "mcp"] as const;
export type DeviceClient = (typeof DEVICE_CLIENTS)[number];

export function generateUserCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export function normalizeUserCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[^A-Z]/g, "");
  if (s.length !== 8 || [...s].some((c) => !ALPHABET.includes(c))) return null;
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export async function createDeviceCode(db: Db, client: DeviceClient): Promise<DeviceCodeResponse> {
  const deviceCode = randomToken(32);
  let userCode = generateUserCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await db.insert(deviceCodes).values({
        deviceCodeHash: sha256Hex(deviceCode),
        userCode,
        client,
        expiresAt: new Date(Date.now() + DEVICE_CODE_TTL_S * 1000),
      });
      break;
    } catch (e) {
      if (attempt === 4) throw e;
      userCode = generateUserCode();
    }
  }
  const uri = `${env.appOrigin}/device`;
  return {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: uri,
    verification_uri_complete: `${uri}?code=${encodeURIComponent(userCode)}`,
    expires_in: DEVICE_CODE_TTL_S,
    interval: DEVICE_POLL_INTERVAL_S,
  };
}

export type DevicePollResult =
  | { ok: true; body: DeviceTokenResponse }
  | { ok: false; error: "authorization_pending" | "slow_down" | "expired_token" | "access_denied" | "invalid_grant" };

export async function pollDeviceToken(db: Db, deviceCode: string, now = new Date()): Promise<DevicePollResult> {
  const hash = sha256Hex(deviceCode);
  const row = (await db.select().from(deviceCodes).where(eq(deviceCodes.deviceCodeHash, hash)).limit(1))[0];
  if (!row) return { ok: false, error: "invalid_grant" };
  if (row.expiresAt <= now) return { ok: false, error: "expired_token" };
  if (row.status === "denied") return { ok: false, error: "access_denied" };
  if (row.status === "consumed") return { ok: false, error: "invalid_grant" };
  if (row.status === "pending") {
    const tooFast = row.lastPolledAt && now.getTime() - row.lastPolledAt.getTime() < (DEVICE_POLL_INTERVAL_S - 1) * 1000;
    await db.update(deviceCodes).set({ lastPolledAt: now }).where(eq(deviceCodes.deviceCodeHash, hash));
    return { ok: false, error: tooFast ? "slow_down" : "authorization_pending" };
  }
  // Approved: atomically consume, then mint a token (plaintext returned once, never stored).
  const consumed = await db
    .update(deviceCodes)
    .set({ status: "consumed" })
    .where(and(eq(deviceCodes.deviceCodeHash, hash), eq(deviceCodes.status, "approved")))
    .returning({ userId: deviceCodes.userId, client: deviceCodes.client });
  const c = consumed[0];
  if (!c?.userId) return { ok: false, error: "invalid_grant" };
  const user = (await db.select({ username: users.username, timezone: users.timezone }).from(users).where(eq(users.id, c.userId)).limit(1))[0];
  if (!user) return { ok: false, error: "invalid_grant" };
  const label = c.client === "mcp" ? "MCP server (device login)" : "Collector (device login)";
  const { token } = await createIngestToken(db, c.userId, label);
  return { ok: true, body: { access_token: token, token_type: "bearer", username: user.username, timezone: user.timezone } };
}

export async function findDeviceCode(db: Db, userCode: string) {
  const code = normalizeUserCode(userCode);
  if (!code) return null;
  const row = (await db.select().from(deviceCodes).where(eq(deviceCodes.userCode, code)).limit(1))[0];
  if (!row || row.expiresAt <= new Date() || row.status !== "pending") return null;
  return { userCode: row.userCode, client: row.client };
}

export async function decideDeviceCode(db: Db, userCode: string, userId: string, approve: boolean): Promise<boolean> {
  const code = normalizeUserCode(userCode);
  if (!code) return false;
  const res = await db
    .update(deviceCodes)
    .set({ status: approve ? "approved" : "denied", userId })
    .where(and(eq(deviceCodes.userCode, code), eq(deviceCodes.status, "pending"), sql`${deviceCodes.expiresAt} > now()`))
    .returning({ userCode: deviceCodes.userCode });
  return res.length > 0;
}
