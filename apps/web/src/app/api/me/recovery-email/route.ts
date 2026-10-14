import { z } from "zod";
import { getDb } from "@/db/client";
import { setRecoveryEmail } from "@/server/account";
import { api, ApiError, assertSameOrigin, enforceRateLimit, json, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { getCurrentUser } from "@/server/session";

const bodySchema = z.strictObject({ email: z.string().max(254).nullable() });

/** PUT /api/me/recovery-email — stores only an HMAC of the address (null removes it). */
export const PUT = api("PUT /api/me/recovery-email", async (req) => {
  assertSameOrigin(req);
  const me = await getCurrentUser();
  if (!me) throw new ApiError(401, "unauthorized", "Sign in required.");
  enforceRateLimit(`account:${me.id}`, LIMITS.account);
  const parsed = bodySchema.safeParse(await readJson(req, 2_000));
  if (!parsed.success) throw new ApiError(400, "invalid_request", "Invalid email.");
  await setRecoveryEmail(getDb(), me.id, parsed.data.email?.trim() || null);
  return json({ ok: true });
});
