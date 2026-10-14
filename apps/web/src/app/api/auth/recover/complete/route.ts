import { z } from "zod";
import { getDb } from "@/db/client";
import { api, ApiError, assertSameOrigin, clientIp, enforceRateLimit, json, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { consumeRecoveryToken } from "@/server/recovery";
import { createSession } from "@/server/session";

const bodySchema = z.strictObject({ token: z.string().max(100) });

/** POST /api/auth/recover/complete — consume a one-time link (via a button, so link scanners can't). */
export const POST = api("POST /api/auth/recover/complete", async (req) => {
  assertSameOrigin(req);
  enforceRateLimit(`auth:${clientIp(req)}`, LIMITS.auth);
  const parsed = bodySchema.safeParse(await readJson(req, 1_000));
  if (!parsed.success) throw new ApiError(400, "invalid_request", "Missing token.");
  const db = getDb();
  const userId = await consumeRecoveryToken(db, parsed.data.token);
  if (!userId) throw new ApiError(400, "invalid_token", "This link is invalid or has expired.");
  await createSession(userId, db);
  return json({ ok: true });
});
