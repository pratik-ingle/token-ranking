import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { passkeys } from "@/db/schema";
import { api, ApiError, assertSameOrigin, json, readJson } from "@/server/http";
import { getCurrentUser } from "@/server/session";
import { finishPasskeyRegistration } from "@/server/webauthn";

const bodySchema = z.object({ response: z.record(z.string(), z.unknown()) });

export const POST = api("POST /api/auth/passkey/add/verify", async (req) => {
  assertSameOrigin(req);
  const me = await getCurrentUser();
  if (!me) throw new ApiError(401, "unauthorized", "Sign in required.");
  const parsed = bodySchema.safeParse(await readJson(req, 50_000));
  if (!parsed.success) throw new ApiError(400, "invalid_request", "Missing passkey response.");
  const result = await finishPasskeyRegistration("add-passkey", parsed.data.response as unknown as RegistrationResponseJSON);
  if (result.username !== me.username) throw new ApiError(400, "passkey_failed", "Passkey does not belong to this account.");
  await getDb().insert(passkeys).values({ ...result.credential, userId: me.id });
  return json({ ok: true }, { status: 201 });
});
