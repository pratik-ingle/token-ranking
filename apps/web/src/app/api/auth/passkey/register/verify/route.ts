import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { api, ApiError, assertSameOrigin, json, readJson } from "@/server/http";
import { createSession } from "@/server/session";
import { assertUsernameAvailable, createUser, resolveTimeZone } from "@/server/signup";
import { finishPasskeyRegistration } from "@/server/webauthn";

const bodySchema = z.object({ response: z.record(z.string(), z.unknown()), timezone: z.string().max(64).optional() });

/** POST /api/auth/passkey/register/verify — finish passkey sign-up, create the account and sign in. */
export const POST = api("POST /api/auth/passkey/register/verify", async (req) => {
  assertSameOrigin(req);
  const parsed = bodySchema.safeParse(await readJson(req, 50_000));
  if (!parsed.success) throw new ApiError(400, "invalid_request", "Missing passkey response.");
  const db = getDb();
  const result = await finishPasskeyRegistration("register", parsed.data.response as unknown as RegistrationResponseJSON);
  const username = await assertUsernameAvailable(db, result.username);
  const user = await createUser(db, {
    username,
    timezone: await resolveTimeZone(db, parsed.data.timezone),
    webauthnUserId: result.webauthnUserId,
    passkey: result.credential,
  });
  await createSession(user.id, db);
  return json({ username: user.username }, { status: 201 });
});
