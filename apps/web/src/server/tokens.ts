import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { ingestTokens, users } from "@/db/schema";
import { randomToken, sha256Hex } from "./crypto";

export type TokenScope = "ingest" | "read";
export const TOKEN_PREFIX = "tr_";

export interface TokenUser {
  tokenId: string;
  scopes: TokenScope[];
  user: { id: string; username: string; timezone: string; visibility: "public" | "hidden" };
}

/** Creates a personal ingest token. The plaintext is returned once and never stored. */
export async function createIngestToken(
  db: Db,
  userId: string,
  name: string,
  scopes: TokenScope[] = ["ingest", "read"],
): Promise<{ id: string; token: string; prefix: string }> {
  const token = `${TOKEN_PREFIX}${randomToken(32)}`;
  const prefix = token.slice(0, 10);
  const [row] = await db
    .insert(ingestTokens)
    .values({ userId, name: name.slice(0, 40) || "token", tokenHash: sha256Hex(token), tokenPrefix: prefix, scopes })
    .returning({ id: ingestTokens.id });
  return { id: row!.id, token, prefix };
}

export async function verifyIngestToken(db: Db, token: string): Promise<TokenUser | null> {
  if (!token.startsWith(TOKEN_PREFIX) || token.length > 100) return null;
  const rows = await db
    .select({
      tokenId: ingestTokens.id,
      scopes: ingestTokens.scopes,
      lastUsedAt: ingestTokens.lastUsedAt,
      id: users.id,
      username: users.username,
      timezone: users.timezone,
      visibility: users.visibility,
    })
    .from(ingestTokens)
    .innerJoin(users, eq(users.id, ingestTokens.userId))
    .where(and(eq(ingestTokens.tokenHash, sha256Hex(token)), isNull(ingestTokens.revokedAt)))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  // Touch last_used_at at most once a minute.
  if (!r.lastUsedAt || Date.now() - r.lastUsedAt.getTime() > 60_000) {
    await db.execute(sql`UPDATE ingest_tokens SET last_used_at = now() WHERE id = ${r.tokenId}`);
  }
  return {
    tokenId: r.tokenId,
    scopes: r.scopes as TokenScope[],
    user: { id: r.id, username: r.username, timezone: r.timezone, visibility: r.visibility },
  };
}

export async function revokeIngestToken(db: Db, userId: string, tokenId: string): Promise<boolean> {
  const res = await db
    .update(ingestTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(ingestTokens.id, tokenId), eq(ingestTokens.userId, userId), isNull(ingestTokens.revokedAt)))
    .returning({ id: ingestTokens.id });
  return res.length > 0;
}
