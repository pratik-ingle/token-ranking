import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { passkeys, users } from "@/db/schema";
import { api, ApiError, assertSameOrigin, json } from "@/server/http";
import { getCurrentUser } from "@/server/session";
import { startPasskeyRegistration } from "@/server/webauthn";

/** POST /api/auth/passkey/add/options — add another passkey to the signed-in account. */
export const POST = api("POST /api/auth/passkey/add/options", async (req) => {
  assertSameOrigin(req);
  const me = await getCurrentUser();
  if (!me) throw new ApiError(401, "unauthorized", "Sign in required.");
  const db = getDb();
  const u = (await db.select({ webauthnUserId: users.webauthnUserId }).from(users).where(eq(users.id, me.id)).limit(1))[0]!;
  const existing = await db.select({ id: passkeys.id, transports: passkeys.transports }).from(passkeys).where(eq(passkeys.userId, me.id));
  return json(
    await startPasskeyRegistration({
      kind: "add-passkey",
      username: me.username,
      webauthnUserId: u.webauthnUserId,
      excludeCredentialIds: existing.map((p) => ({ id: p.id, transports: p.transports?.split(",") })),
    }),
  );
});
