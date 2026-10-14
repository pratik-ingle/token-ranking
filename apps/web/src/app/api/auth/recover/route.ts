import { z } from "zod";
import { getDb } from "@/db/client";
import { validateEmail } from "@/server/account";
import { api, assertSameOrigin, clientIp, enforceRateLimit, json, readJson } from "@/server/http";
import { requestRecovery } from "@/server/recovery";

const bodySchema = z.strictObject({ email: z.string().max(254) });

/** POST /api/auth/recover — always responds the same, whether or not the email matched. */
export const POST = api("POST /api/auth/recover", async (req) => {
  assertSameOrigin(req);
  enforceRateLimit(`recover:${clientIp(req)}`, { limit: 5, windowMs: 15 * 60_000 });
  const parsed = bodySchema.safeParse(await readJson(req, 2_000));
  if (parsed.success && validateEmail(parsed.data.email)) {
    await requestRecovery(getDb(), parsed.data.email);
  }
  return json({ ok: true, message: "If that email is set as a recovery address, a sign-in link is on its way." });
});
