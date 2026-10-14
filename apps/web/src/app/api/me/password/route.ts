import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { api, ApiError, assertSameOrigin, enforceRateLimit, json, readJson } from "@/server/http";
import { hashPassword, validatePassword, verifyPassword } from "@/server/password";
import { LIMITS } from "@/server/rate-limit";
import { getCurrentUser } from "@/server/session";

const bodySchema = z.strictObject({ current: z.string().max(512).optional(), password: z.string().max(512) });

/** PUT /api/me/password — set or change the fallback password. */
export const PUT = api("PUT /api/me/password", async (req) => {
  assertSameOrigin(req);
  const me = await getCurrentUser();
  if (!me) throw new ApiError(401, "unauthorized", "Sign in required.");
  enforceRateLimit(`account:${me.id}`, LIMITS.auth);
  const parsed = bodySchema.safeParse(await readJson(req, 4_000));
  if (!parsed.success) throw new ApiError(400, "invalid_request", "Password required.");
  const db = getDb();
  const u = (await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, me.id)).limit(1))[0];
  if (u?.hash && !(await verifyPassword(parsed.data.current ?? "", u.hash))) {
    throw new ApiError(401, "invalid_credentials", "Current password is wrong.");
  }
  const err = validatePassword(parsed.data.password);
  if (err) throw new ApiError(400, "weak_password", err);
  await db.update(users).set({ passwordHash: await hashPassword(parsed.data.password) }).where(eq(users.id, me.id));
  return json({ ok: true });
});
