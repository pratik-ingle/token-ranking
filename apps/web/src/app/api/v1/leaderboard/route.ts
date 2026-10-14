import { leaderboardQuerySchema } from "@tokenrank/shared";
import { getDb } from "@/db/client";
import { optionalUser } from "@/server/auth";
import { api, ApiError, clientIp, enforceRateLimit, json } from "@/server/http";
import { getLeaderboard } from "@/server/leaderboard";
import { LIMITS } from "@/server/rate-limit";

/** GET /api/v1/leaderboard?window=&source=&category=&verified=&cache=&page=&page_size= */
export const GET = api("GET /api/v1/leaderboard", async (req) => {
  enforceRateLimit(`public:${clientIp(req)}`, LIMITS.publicApi);
  const parsed = leaderboardQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) throw new ApiError(400, "invalid_query", parsed.error.issues[0]?.message ?? "Invalid query.");
  const me = await optionalUser(req);
  return json(await getLeaderboard(getDb(), parsed.data, me));
});
