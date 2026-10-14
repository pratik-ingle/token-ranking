import { getDb } from "@/db/client";
import { api, ApiError, clientIp, enforceRateLimit, json } from "@/server/http";
import { assertUsernameAvailable } from "@/server/signup";

/** GET /api/auth/username?u= — availability check while typing. */
export const GET = api("GET /api/auth/username", async (req) => {
  enforceRateLimit(`username:${clientIp(req)}`, { limit: 60, windowMs: 60_000 });
  try {
    const username = await assertUsernameAvailable(getDb(), req.nextUrl.searchParams.get("u") ?? "");
    return json({ available: true, username });
  } catch (e) {
    if (e instanceof ApiError) return json({ available: false, error: e.code, message: e.message });
    throw e;
  }
});
