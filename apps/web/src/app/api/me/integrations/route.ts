import { getDb } from "@/db/client";
import { api, ApiError, json } from "@/server/http";
import { listIntegrations } from "@/server/integrations";
import { getCurrentUser } from "@/server/session";

export const GET = api("GET /api/me/integrations", async () => {
  const me = await getCurrentUser();
  if (!me) throw new ApiError(401, "unauthorized", "Sign in required.");
  return json({ integrations: await listIntegrations(getDb(), me.id) });
});
