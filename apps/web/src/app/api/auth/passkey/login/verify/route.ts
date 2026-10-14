import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { passkeys, users } from "@/db/schema";
import { api, ApiError, assertSameOrigin, json, readJson } from "@/server/http";
import { createSession } from "@/server/session";
import { touchPasskey } from "@/server/signup";
import { finishPasskeyLogin } from "@/server/webauthn";

const bodySchema = z.object({ response: z.record(z.string(), z.unknown()) });

export const POST = api("POST /api/auth/passkey/login/verify", async (req) => {
  assertSameOrigin(req);
  const parsed = bodySchema.safeParse(await readJson(req, 50_000));
  if (!parsed.success) throw new ApiError(400, "invalid_request", "Missing passkey response.");
  const db = getDb();
  let userId: string | null = null;
  const result = await finishPasskeyLogin(parsed.data.response as unknown as AuthenticationResponseJSON, async (credentialId) => {
    const pk = (await db.select().from(passkeys).where(eq(passkeys.id, credentialId)).limit(1))[0];
    if (!pk) return null;
    userId = pk.userId;
    return { publicKey: pk.publicKey, counter: pk.counter, transports: pk.transports };
  });
  if (!userId) throw new ApiError(400, "unknown_passkey", "Unknown passkey.");
  await touchPasskey(db, result.credentialId, result.newCounter);
  await createSession(userId, db);
  const u = (await db.select({ username: users.username }).from(users).where(eq(users.id, userId)).limit(1))[0];
  return json({ username: u?.username });
});
