import { z } from "zod";
import { getDb } from "@/db/client";
import { DEVICE_CLIENTS, createDeviceCode } from "@/server/device";
import { api, ApiError, clientIp, enforceRateLimit, json, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";

const bodySchema = z.strictObject({ client: z.enum(DEVICE_CLIENTS).default("collector") });

/** POST /api/v1/device/code — start a device login (RFC 8628) for the CLI / MCP server. */
export const POST = api("POST /api/v1/device/code", async (req) => {
  enforceRateLimit(`device:${clientIp(req)}`, LIMITS.deviceCode);
  const parsed = bodySchema.safeParse(await readJson(req, 1_000).catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "invalid_request", "Invalid client.");
  return json(await createDeviceCode(getDb(), parsed.data.client));
});
