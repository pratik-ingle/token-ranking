import type { MeRankResponse } from "@tokenrank/shared";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { env } from "@/server/env";
import { api, json } from "@/server/http";
import { getWindowRanks } from "@/server/leaderboard";

/** GET /api/v1/me/rank?cache=true — rank and percentile in every window (works for hidden users too). */
export const GET = api("GET /api/v1/me/rank", async (req) => {
  const db = getDb();
  const user = await requireUser(req, "read", db);
  const cache = req.nextUrl.searchParams.get("cache") !== "false";
  const body: MeRankResponse = {
    username: user.username,
    visibility: user.visibility,
    include_cache: cache,
    windows: await getWindowRanks(db, user, { cache }),
    profile_url: `${env.appOrigin}/u/${user.username}`,
  };
  return json(body);
});
