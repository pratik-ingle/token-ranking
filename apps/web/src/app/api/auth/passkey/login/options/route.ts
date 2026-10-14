import { api, assertSameOrigin, clientIp, enforceRateLimit, json } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { startPasskeyLogin } from "@/server/webauthn";

/** POST /api/auth/passkey/login/options — usernameless (discoverable credential) sign-in. */
export const POST = api("POST /api/auth/passkey/login/options", async (req) => {
  assertSameOrigin(req);
  enforceRateLimit(`auth:${clientIp(req)}`, LIMITS.auth);
  return json(await startPasskeyLogin());
});
