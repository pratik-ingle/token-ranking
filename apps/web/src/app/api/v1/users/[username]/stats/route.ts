import { getDb } from "@/db/client";
import { optionalUser } from "@/server/auth";
import { api, ApiError, clientIp, enforceRateLimit, json } from "@/server/http";
import { getUserByUsername, getUserStats } from "@/server/leaderboard";
import { LIMITS } from "@/server/rate-limit";

/** GET /api/v1/users/{username}/stats — public profiles, or your own when hidden. */
export const GET = api<{ params: Promise<{ username: string }> }>("GET /api/v1/users/:username/stats", async (req, ctx) => {
  enforceRateLimit(`public:${clientIp(req)}`, LIMITS.publicApi);
  const { username } = await ctx.params;
  const db = getDb();
  const user = await getUserByUsername(db, username);
  const me = await optionalUser(req);
  if (!user || (user.visibility === "hidden" && me?.id !== user.id)) throw new ApiError(404, "not_found", "No such public profile.");
  const cache = req.nextUrl.searchParams.get("cache") !== "false";
  return json(await getUserStats(db, user, { cache }));
});
