import { normalizeUsername } from "@tokenrank/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { api, ApiError, assertSameOrigin, clientIp, enforceRateLimit, json, readJson } from "@/server/http";
import { verifyPassword } from "@/server/password";
import { LIMITS } from "@/server/rate-limit";
import { createSession } from "@/server/session";

const bodySchema = z.strictObject({ username: z.string().max(64), password: z.string().max(512) });

/** POST /api/auth/login — password sign-in. */
export const POST = api("POST /api/auth/login", async (req) => {
  assertSameOrigin(req);
  enforceRateLimit(`auth:${clientIp(req)}`, LIMITS.auth);
  const parsed = bodySchema.safeParse(await readJson(req, 10_000));
  if (!parsed.success) throw new ApiError(400, "invalid_request", "Username and password are required.");
  const db = getDb();
  const username = normalizeUsername(parsed.data.username);
  enforceRateLimit(`auth-user:${username}`, LIMITS.auth);
  const u = (await db.select({ id: users.id, passwordHash: users.passwordHash }).from(users).where(eq(users.username, username)).limit(1))[0];
  const ok = await verifyPassword(parsed.data.password, u?.passwordHash ?? null);
  if (!u || !ok) throw new ApiError(401, "invalid_credentials", "Wrong username or password.");
  await createSession(u.id, db);
  return json({ username });
});
