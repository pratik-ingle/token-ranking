import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { env } from "@/server/env";
import { api, json } from "@/server/http";

/** GET /api/v1/me — who this token / session belongs to. */
export const GET = api("GET /api/v1/me", async (req) => {
  const user = await requireUser(req, "read", getDb());
  return json({
    username: user.username,
    timezone: user.timezone,
    visibility: user.visibility,
    profile_url: `${env.appOrigin}/u/${user.username}`,
  });
});
