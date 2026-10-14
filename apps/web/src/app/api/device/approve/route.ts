import { z } from "zod";
import { getDb } from "@/db/client";
import { decideDeviceCode } from "@/server/device";
import { api, ApiError, assertSameOrigin, json, readJson } from "@/server/http";
import { getCurrentUser } from "@/server/session";

const bodySchema = z.strictObject({ user_code: z.string().max(20), approve: z.boolean() });

/** POST /api/device/approve — the signed-in user approves or denies a CLI/MCP login. */
export const POST = api("POST /api/device/approve", async (req) => {
  assertSameOrigin(req);
  const me = await getCurrentUser();
  if (!me) throw new ApiError(401, "unauthorized", "Sign in required.");
  const parsed = bodySchema.safeParse(await readJson(req, 1_000));
  if (!parsed.success) throw new ApiError(400, "invalid_request", "Invalid code.");
  const ok = await decideDeviceCode(getDb(), parsed.data.user_code, me.id, parsed.data.approve);
  if (!ok) throw new ApiError(404, "invalid_code", "This code is invalid, expired or already used.");
  return json({ ok: true, approved: parsed.data.approve });
});
