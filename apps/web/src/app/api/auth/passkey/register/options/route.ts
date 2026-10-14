import { z } from "zod";
import { getDb } from "@/db/client";
import { api, ApiError, assertSameOrigin, clientIp, enforceRateLimit, json, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { assertUsernameAvailable, newWebauthnUserId } from "@/server/signup";
import { startPasskeyRegistration } from "@/server/webauthn";

const bodySchema = z.strictObject({ username: z.string().max(64) });

/** POST /api/auth/passkey/register/options — begin passkey sign-up for a new username. */
export const POST = api("POST /api/auth/passkey/register/options", async (req) => {
  assertSameOrigin(req);
  enforceRateLimit(`auth:${clientIp(req)}`, LIMITS.auth);
  const parsed = bodySchema.safeParse(await readJson(req, 2_000));
  if (!parsed.success) throw new ApiError(400, "invalid_request", "Username is required.");
  const username = await assertUsernameAvailable(getDb(), parsed.data.username);
  return json(await startPasskeyRegistration({ kind: "register", username, webauthnUserId: newWebauthnUserId() }));
});
