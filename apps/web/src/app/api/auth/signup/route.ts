import { z } from "zod";
import { getDb } from "@/db/client";
import { api, ApiError, assertSameOrigin, clientIp, enforceRateLimit, json, readJson } from "@/server/http";
import { hashPassword, validatePassword } from "@/server/password";
import { LIMITS } from "@/server/rate-limit";
import { createSession } from "@/server/session";
import { assertUsernameAvailable, createUser, resolveTimeZone } from "@/server/signup";

const bodySchema = z.strictObject({ username: z.string().max(64), password: z.string().max(512), timezone: z.string().max(64).optional() });

/** POST /api/auth/signup — password fallback sign-up (username + password only). */
export const POST = api("POST /api/auth/signup", async (req) => {
  assertSameOrigin(req);
  enforceRateLimit(`auth:${clientIp(req)}`, LIMITS.auth);
  const parsed = bodySchema.safeParse(await readJson(req, 10_000));
  if (!parsed.success) throw new ApiError(400, "invalid_request", "Username and password are required.");
  const db = getDb();
  const username = await assertUsernameAvailable(db, parsed.data.username);
  const pwError = validatePassword(parsed.data.password);
  if (pwError) throw new ApiError(400, "weak_password", pwError);
  const user = await createUser(db, {
    username,
    timezone: await resolveTimeZone(db, parsed.data.timezone),
    passwordHash: await hashPassword(parsed.data.password),
  });
  await createSession(user.id, db);
  return json({ username: user.username }, { status: 201 });
});
