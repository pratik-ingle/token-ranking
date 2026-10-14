import { dateStringSchema, sourceSchema } from "@tokenrank/shared";
import { z } from "zod";
import { getDb } from "@/db/client";
import { api, ApiError, assertSameOrigin, json, readJson } from "@/server/http";
import { decideFlagged } from "@/server/review";
import { getCurrentUser, isAdmin } from "@/server/session";

const bodySchema = z.strictObject({
  user_id: z.uuid(),
  date: dateStringSchema,
  source: sourceSchema,
  decision: z.enum(["approved", "rejected"]),
});

/** POST /api/admin/review — moderators approve or reject flagged days. */
export const POST = api("POST /api/admin/review", async (req) => {
  assertSameOrigin(req);
  const me = await getCurrentUser();
  if (!isAdmin(me)) throw new ApiError(403, "forbidden", "Moderators only.");
  const parsed = bodySchema.safeParse(await readJson(req, 2_000));
  if (!parsed.success) throw new ApiError(400, "invalid_request", "Invalid review.");
  await decideFlagged(getDb(), parsed.data.user_id, parsed.data.date, parsed.data.source, parsed.data.decision);
  return json({ ok: true });
});
