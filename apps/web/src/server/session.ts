import { and, eq, gt, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { cache } from "react";
import { getDb, type Db } from "@/db/client";
import { sessions, users } from "@/db/schema";
import { randomToken, sha256Hex } from "./crypto";
import { env } from "./env";

export const SESSION_COOKIE = "tr_session";
const SESSION_DAYS = 30;

export interface SessionUser {
  id: string;
  username: string;
  visibility: "public" | "hidden";
  timezone: string;
  createdAt: Date;
  hasPassword: boolean;
  hasRecoveryEmail: boolean;
}

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: env.appOrigin.startsWith("https://"),
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** Creates a session row (hash only) and sets the cookie. */
export async function createSession(userId: string, db: Db = getDb()): Promise<void> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ id: sha256Hex(token), userId, expiresAt });
  // Opportunistic cleanup of this user's expired sessions.
  await db.execute(sql`DELETE FROM sessions WHERE user_id = ${userId} AND expires_at < now()`);
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions(SESSION_DAYS * 86_400));
}

export async function destroySession(db: Db = getDb()): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.id, sha256Hex(token)));
  jar.set(SESSION_COOKIE, "", cookieOptions(0));
}

export async function userForSessionToken(token: string, db: Db = getDb()): Promise<SessionUser | null> {
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      visibility: users.visibility,
      timezone: users.timezone,
      createdAt: users.createdAt,
      passwordHash: users.passwordHash,
      recoveryEmailHmac: users.recoveryEmailHmac,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256Hex(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const u = rows[0];
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    visibility: u.visibility,
    timezone: u.timezone,
    createdAt: u.createdAt,
    hasPassword: Boolean(u.passwordHash),
    hasRecoveryEmail: Boolean(u.recoveryEmailHmac),
  };
}

/** The signed-in user for this request (memoised per request). */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  return userForSessionToken(token);
});

export function isAdmin(user: Pick<SessionUser, "username"> | null): boolean {
  return Boolean(user && env.adminUsernames.has(user.username));
}
