import { validateUsername } from "@tokenrank/shared";
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { passkeys, users } from "@/db/schema";
import { assertTimeZone } from "./account";
import { ApiError } from "./http";

export async function assertUsernameAvailable(db: Db, input: string): Promise<string> {
  const v = validateUsername(input);
  if (!v.ok) throw new ApiError(400, `username_${v.error}`, v.message);
  const taken = await db.select({ id: users.id }).from(users).where(eq(users.username, v.username)).limit(1);
  if (taken.length) throw new ApiError(409, "username_taken", "That username is taken.");
  return v.username;
}

export async function resolveTimeZone(db: Db, tz: unknown): Promise<string> {
  if (typeof tz !== "string" || !tz) return "UTC";
  try {
    await assertTimeZone(db, tz);
    return tz;
  } catch {
    return "UTC";
  }
}

export function newWebauthnUserId(): string {
  return randomBytes(16).toString("base64url");
}

/** Creates the user (and optionally their first passkey) atomically; maps a username race to 409. */
export async function createUser(
  db: Db,
  params: {
    username: string;
    timezone: string;
    passwordHash?: string | null;
    webauthnUserId?: string;
    passkey?: { id: string; publicKey: string; counter: number; transports: string | null; deviceType: string; backedUp: boolean };
  },
): Promise<{ id: string; username: string }> {
  try {
    return await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({
          username: params.username,
          timezone: params.timezone,
          passwordHash: params.passwordHash ?? null,
          webauthnUserId: params.webauthnUserId ?? newWebauthnUserId(),
        })
        .returning({ id: users.id, username: users.username });
      if (params.passkey) {
        await tx.insert(passkeys).values({ ...params.passkey, userId: u!.id });
      }
      return u!;
    });
  } catch (e) {
    if (String((e as { code?: string }).code) === "23505" || /unique|duplicate/i.test(String(e))) {
      throw new ApiError(409, "username_taken", "That username is taken.");
    }
    throw e;
  }
}

export async function touchPasskey(db: Db, id: string, counter: number): Promise<void> {
  await db.execute(sql`UPDATE passkeys SET counter = ${counter}, last_used_at = now() WHERE id = ${id}`);
}
