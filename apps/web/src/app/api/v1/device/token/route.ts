import { z } from "zod";
import { getDb } from "@/db/client";
import { pollDeviceToken } from "@/server/device";
import { api, clientIp, enforceRateLimit, json, readJson } from "@/server/http";

const bodySchema = z.strictObject({ device_code: z.string().min(10).max(100) });

/** POST /api/v1/device/token — poll for the token after the user approves in the browser. */
export const POST = api("POST /api/v1/device/token", async (req) => {
  enforceRateLimit(`device-poll:${clientIp(req)}`, { limit: 60, windowMs: 60_000 });
  const parsed = bodySchema.safeParse(await readJson(req, 1_000).catch(() => ({})));
  if (!parsed.success) return json({ error: "invalid_request" }, { status: 400 });
  const result = await pollDeviceToken(getDb(), parsed.data.device_code);
  return result.ok ? json(result.body) : json({ error: result.error }, { status: 400 });
});
