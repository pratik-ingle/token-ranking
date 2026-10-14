import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { ingestTokens } from "@/db/schema";
import { api, ApiError, assertSameOrigin, enforceRateLimit, json, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { getCurrentUser } from "@/server/session";
import { createIngestToken } from "@/server/tokens";

export const GET = api("GET /api/me/tokens", async () => {
  const me = await getCurrentUser();
  if (!me) throw new ApiError(401, "unauthorized", "Sign in required.");
  const rows = await getDb()
    .select({ id: ingestTokens.id, name: ingestTokens.name, prefix: ingestTokens.tokenPrefix, scopes: ingestTokens.scopes, created_at: ingestTokens.createdAt, last_used_at: ingestTokens.lastUsedAt })
    .from(ingestTokens)
    .where(and(eq(ingestTokens.userId, me.id), isNull(ingestTokens.revokedAt)))
    .orderBy(desc(ingestTokens.createdAt));
  return json({ tokens: rows });
});

const bodySchema = z.strictObject({ name: z.string().trim().min(1).max(40), scopes: z.array(z.enum(["ingest", "read"])).min(1).optional() });

/** POST /api/me/tokens — create a personal ingest token; the plaintext is shown once. */
export const POST = api("POST /api/me/tokens", async (req) => {
  assertSameOrigin(req);
  const me = await getCurrentUser();
  if (!me) throw new ApiError(401, "unauthorized", "Sign in required.");
  enforceRateLimit(`account:${me.id}`, LIMITS.account);
  const parsed = bodySchema.safeParse(await readJson(req, 2_000));
  if (!parsed.success) throw new ApiError(400, "invalid_request", "Give the token a name (max 40 characters).");
  const t = await createIngestToken(getDb(), me.id, parsed.data.name, parsed.data.scopes ?? ["ingest", "read"]);
  return json({ id: t.id, token: t.token, prefix: t.prefix }, { status: 201 });
});
