import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { recoveryTokens, users } from "@/db/schema";
import { randomToken, recoveryEmailHmac, sha256Hex } from "./crypto";
import { env } from "./env";
import { sendRecoveryEmail } from "./mailer";

const TTL_MS = 30 * 60_000;

/**
 * Looks up accounts by HMAC(email) and mails a one-time sign-in link to the
 * address the user just typed. Always behaves the same whether or not an
 * account matched, so it can't be used to probe which emails are registered.
 */
export async function requestRecovery(db: Db, email: string): Promise<void> {
  const matches = await db.select({ id: users.id }).from(users).where(eq(users.recoveryEmailHmac, recoveryEmailHmac(email))).limit(5);
  for (const m of matches) {
    const token = randomToken(32);
    await db.insert(recoveryTokens).values({ tokenHash: sha256Hex(token), userId: m.id, expiresAt: new Date(Date.now() + TTL_MS) });
    await sendRecoveryEmail(email, `${env.appOrigin}/recover/${token}`);
  }
}

/** Consumes a recovery token; returns the user id to sign in, or null. */
export async function consumeRecoveryToken(db: Db, token: string): Promise<string | null> {
  if (token.length > 100) return null;
  const res = await db
    .update(recoveryTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(recoveryTokens.tokenHash, sha256Hex(token)), isNull(recoveryTokens.usedAt), gt(recoveryTokens.expiresAt, new Date())))
    .returning({ userId: recoveryTokens.userId });
  return res[0]?.userId ?? null;
}
