import type { Db } from "@/db/client";
import { getDb } from "@/db/client";
import { ApiError, clientIp, enforceRateLimit } from "./http";
import { LIMITS } from "./rate-limit";
import { getCurrentUser } from "./session";
import { verifyIngestToken, type TokenScope } from "./tokens";

export interface ApiUser {
  id: string;
  username: string;
  timezone: string;
  visibility: "public" | "hidden";
  via: "token" | "session";
  tokenId?: string;
}

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m ? m[1]! : null;
}

/** Bearer ingest token (CLI, MCP, community connectors) with the given scope. */
export async function requireToken(req: Request, scope: TokenScope, db: Db = getDb()): Promise<ApiUser> {
  const token = bearer(req);
  if (!token) {
    enforceRateLimit(`auth-fail:${clientIp(req)}`, LIMITS.auth);
    throw new ApiError(401, "unauthorized", "Missing bearer token.");
  }
  const t = await verifyIngestToken(db, token);
  if (!t) {
    enforceRateLimit(`auth-fail:${clientIp(req)}`, LIMITS.auth);
    throw new ApiError(401, "unauthorized", "Invalid or revoked token. Run `npx tokenrank-collector login` again.");
  }
  if (!t.scopes.includes(scope)) throw new ApiError(403, "insufficient_scope", `Token lacks the "${scope}" scope.`);
  return { ...t.user, via: "token", tokenId: t.tokenId };
}

/** Bearer token if present, otherwise the browser session. */
export async function requireUser(req: Request, scope: TokenScope = "read", db: Db = getDb()): Promise<ApiUser> {
  if (req.headers.get("authorization")) return requireToken(req, scope, db);
  const u = await getCurrentUser();
  if (!u) throw new ApiError(401, "unauthorized", "Sign in required.");
  return { id: u.id, username: u.username, timezone: u.timezone, visibility: u.visibility, via: "session" };
}

export async function optionalUser(req: Request, db: Db = getDb()): Promise<ApiUser | null> {
  try {
    return await requireUser(req, "read", db);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}
