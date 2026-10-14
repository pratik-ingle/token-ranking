import { getDb } from "@/db/client";
import { api, clientIp, enforceRateLimit, json } from "@/server/http";
import { getGlobalStats } from "@/server/leaderboard";
import { LIMITS } from "@/server/rate-limit";

/** GET /api/v1/stats — global totals for the landing page. */
export const GET = api("GET /api/v1/stats", async (req) => {
  enforceRateLimit(`public:${clientIp(req)}`, LIMITS.publicApi);
  return json(await getGlobalStats(getDb()));
});
