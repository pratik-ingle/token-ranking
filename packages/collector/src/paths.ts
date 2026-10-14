import os from "node:os";
import path from "node:path";
import { isDirectory } from "./files";

/** Environment lookups go through this so tests (and the MCP server) can inject one. */
export type Env = Record<string, string | undefined>;

export function homeDir(env: Env): string {
  return env.HOME || env.USERPROFILE || os.homedir();
}

export function expandHome(p: string, env: Env): string {
  if (p === "~") return homeDir(env);
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(homeDir(env), p.slice(2));
  return p;
}

/** `$TOKENRANK_HOME` or `~/.tokenrank`. */
export function tokenrankHome(env: Env): string {
  const override = env.TOKENRANK_HOME?.trim();
  return override ? path.resolve(expandHome(override, env)) : path.join(homeDir(env), ".tokenrank");
}

/**
 * Claude Code config roots: `$CLAUDE_CONFIG_DIR` (comma-separated allowed),
 * else `~/.claude`; plus the legacy `~/.config/claude`. Explicit overrides
 * (`--claude-dir`, config `paths`) replace the defaults entirely.
 */
export function claudeRoots(env: Env, overrides?: readonly string[]): string[] {
  const roots: string[] = [];
  if (overrides && overrides.length > 0) {
    roots.push(...overrides);
  } else {
    const fromEnv = (env.CLAUDE_CONFIG_DIR ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (fromEnv.length > 0) roots.push(...fromEnv);
    else roots.push(path.join(homeDir(env), ".claude"));
    roots.push(path.join(homeDir(env), ".config", "claude"));
  }
  return [...new Set(roots.map((r) => path.resolve(expandHome(r, env))))];
}

/**
 * The directories that are actually scanned for transcripts. Only
 * `<root>/projects` is ever read (never `history.jsonl`, settings, etc.).
 * An explicit override that has no `projects/` child is taken to BE a
 * projects directory.
 */
export async function claudeScanDirs(env: Env, overrides?: readonly string[]): Promise<string[]> {
  const explicit = !!overrides && overrides.length > 0;
  const out: string[] = [];
  for (const root of claudeRoots(env, overrides)) {
    const projects = path.join(root, "projects");
    if (await isDirectory(projects)) out.push(projects);
    else if (explicit && path.basename(root) !== ".claude" && (await isDirectory(root))) out.push(root);
  }
  return out;
}

/** `$CODEX_HOME` or `~/.codex` (or an explicit override). */
export function codexHome(env: Env, override?: string): string {
  const raw = override?.trim() || env.CODEX_HOME?.trim();
  return path.resolve(expandHome(raw || path.join(homeDir(env), ".codex"), env));
}

export async function codexScanDirs(home: string): Promise<{ sessions: string | null; archived: string | null }> {
  const sessions = path.join(home, "sessions");
  const archived = path.join(home, "archived_sessions");
  return {
    sessions: (await isDirectory(sessions)) ? sessions : null,
    archived: (await isDirectory(archived)) ? archived : null,
  };
}
