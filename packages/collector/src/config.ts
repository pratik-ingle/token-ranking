import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { CATEGORIES, type Category } from "@tokenrank/shared";
import { tokenrankHome, type Env } from "./paths";

/** Sources the collector can read. (gemini/other have no local or admin integration.) */
export const COLLECTOR_SOURCES = ["claude_code", "codex_cli", "openai_api", "anthropic_api", "cursor"] as const;
export type CollectorSource = (typeof COLLECTOR_SOURCES)[number];
export const LOCAL_SOURCES = ["claude_code", "codex_cli"] as const;
export const ADMIN_SOURCES = ["openai_api", "anthropic_api", "cursor"] as const;
export type LocalSource = (typeof LOCAL_SOURCES)[number];
export type AdminSource = (typeof ADMIN_SOURCES)[number];

export function isCollectorSource(s: string): s is CollectorSource {
  return (COLLECTOR_SOURCES as readonly string[]).includes(s);
}
export function isLocalSource(s: string): s is LocalSource {
  return (LOCAL_SOURCES as readonly string[]).includes(s);
}
export function isAdminSource(s: string): s is AdminSource {
  return (ADMIN_SOURCES as readonly string[]).includes(s);
}

export const DEFAULT_SERVER = "http://localhost:3000";

/**
 * ~/.tokenrank/config.json (dir 0700, file 0600, written atomically).
 * Everything here stays on this machine; only the token is ever sent, and
 * only to `server`. Admin keys are only ever sent to their own provider.
 */
export interface CollectorConfig {
  version: 1;
  /** TokenRank server base URL the token belongs to. */
  server?: string;
  /** Bearer token ("tr_…") from `login`. */
  token?: string;
  username?: string;
  /** IANA timezone from the server; all events are bucketed into this zone's days. */
  timezone?: string;
  sources: {
    claude_code: { enabled: boolean; paths?: string[] };
    codex_cli: { enabled: boolean; home?: string };
    openai_api: { enabled: boolean; adminKey?: string; categoryMap?: Record<string, Category> };
    anthropic_api: { enabled: boolean; adminKey?: string; categoryMap?: Record<string, Category> };
    cursor: { enabled: boolean; adminKey?: string; email?: string; teamWide?: boolean };
  };
  /** ISO instant of the start of the last successful upload, per source. */
  lastSync: Partial<Record<CollectorSource, string>>;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function configDir(env: Env = process.env): string {
  return tokenrankHome(env);
}

export function configPath(env: Env = process.env): string {
  return path.join(configDir(env), "config.json");
}

export function defaultConfig(): CollectorConfig {
  return {
    version: 1,
    sources: {
      claude_code: { enabled: false },
      codex_cli: { enabled: false },
      openai_api: { enabled: false },
      anthropic_api: { enabled: false },
      cursor: { enabled: false },
    },
    lastSync: {},
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const optStr = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

function categoryMap(v: unknown): Record<string, Category> | undefined {
  if (!isObj(v)) return undefined;
  const out: Record<string, Category> = {};
  for (const [k, c] of Object.entries(v)) {
    if (typeof c === "string" && (CATEGORIES as readonly string[]).includes(c)) out[k] = c as Category;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function prune<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

/** Coerce whatever is on disk into a well-formed config (unknown keys dropped). */
export function normalizeConfig(raw: unknown): CollectorConfig {
  const c = defaultConfig();
  if (!isObj(raw)) return c;
  c.server = optStr(raw.server);
  c.token = optStr(raw.token);
  c.username = optStr(raw.username);
  c.timezone = optStr(raw.timezone);
  const s = isObj(raw.sources) ? raw.sources : {};
  const src = (k: string) => (isObj(s[k]) ? (s[k] as Record<string, unknown>) : {});
  const cc = src("claude_code");
  c.sources.claude_code = prune({
    enabled: cc.enabled === true,
    paths: Array.isArray(cc.paths) ? cc.paths.filter((p): p is string => typeof p === "string" && p.length > 0) : undefined,
  });
  if (c.sources.claude_code.paths?.length === 0) delete c.sources.claude_code.paths;
  const cx = src("codex_cli");
  c.sources.codex_cli = prune({ enabled: cx.enabled === true, home: optStr(cx.home) });
  for (const k of ["openai_api", "anthropic_api"] as const) {
    const o = src(k);
    c.sources[k] = prune({ enabled: o.enabled === true, adminKey: optStr(o.adminKey), categoryMap: categoryMap(o.categoryMap) });
  }
  const cu = src("cursor");
  c.sources.cursor = prune({
    enabled: cu.enabled === true,
    adminKey: optStr(cu.adminKey),
    email: optStr(cu.email),
    teamWide: cu.teamWide === true ? true : undefined,
  });
  if (isObj(raw.lastSync)) {
    for (const [k, v] of Object.entries(raw.lastSync)) {
      if (isCollectorSource(k) && typeof v === "string" && Number.isFinite(Date.parse(v))) c.lastSync[k] = v;
    }
  }
  return prune(c as unknown as Record<string, unknown>) as unknown as CollectorConfig;
}

export async function loadConfig(env: Env = process.env): Promise<CollectorConfig> {
  const file = configPath(env);
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return defaultConfig();
    throw new ConfigError(`cannot read ${file}: ${(err as Error).message}`);
  }
  // Tighten permissions if someone loosened them (best effort).
  try {
    const st = await fs.stat(file);
    if ((st.mode & 0o077) !== 0 && process.platform !== "win32") await fs.chmod(file, 0o600);
  } catch {
    /* ignore */
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ConfigError(`${file} is not valid JSON; fix or delete it`);
  }
  return normalizeConfig(raw);
}

/** Write atomically (temp file + rename) with dir 0700 / file 0600. Returns the path. */
export async function saveConfig(config: CollectorConfig, env: Env = process.env): Promise<string> {
  const dir = configDir(env);
  const file = configPath(env);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await fs.chmod(dir, 0o700);
  const tmp = path.join(dir, `.config.json.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  const body = `${JSON.stringify(normalizeConfig(config), null, 2)}\n`;
  const fh = await fs.open(tmp, "wx", 0o600);
  try {
    await fh.writeFile(body, "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    if (process.platform !== "win32") await fs.chmod(tmp, 0o600);
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return file;
}

/**
 * Re-read the config from disk, apply a mutation and save. Used for small
 * updates (lastSync, timezone) so a concurrent process (cron sync vs. MCP
 * sync) doesn't get its changes overwritten by a stale in-memory copy.
 */
export async function updateConfig(env: Env, mutate: (c: CollectorConfig) => void): Promise<CollectorConfig> {
  const c = await loadConfig(env);
  mutate(c);
  await saveConfig(c, env);
  return c;
}

const REDACTED = "<redacted>";

/** A copy that is safe to print: token and admin keys replaced. */
export function redactConfig(config: CollectorConfig): Record<string, unknown> {
  const c = JSON.parse(JSON.stringify(config)) as CollectorConfig;
  if (c.token) c.token = REDACTED;
  for (const k of ADMIN_SOURCES) {
    const s = c.sources[k] as { adminKey?: string };
    if (s.adminKey) s.adminKey = REDACTED;
  }
  return c as unknown as Record<string, unknown>;
}

export function normalizeServerUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ConfigError(`invalid server URL: ${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ConfigError(`server URL must be http(s): ${raw}`);
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
}

export function isLoopbackUrl(server: string): boolean {
  try {
    const h = new URL(server).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1" || h.endsWith(".localhost");
  } catch {
    return false;
  }
}

export interface ResolvedAuth {
  server: string;
  token: string | undefined;
  /** Where the token came from. */
  from: "env" | "config" | "none";
}

/**
 * The token is only ever sent to the server it was issued by: a config token
 * uses the config's server; `TOKENRANK_TOKEN` pairs with `TOKENRANK_SERVER`.
 */
export function resolveAuth(config: CollectorConfig, env: Env = process.env): ResolvedAuth {
  const envToken = env.TOKENRANK_TOKEN?.trim();
  if (envToken) {
    return { server: normalizeServerUrl(env.TOKENRANK_SERVER?.trim() || config.server || DEFAULT_SERVER), token: envToken, from: "env" };
  }
  if (config.token) {
    return { server: normalizeServerUrl(config.server || env.TOKENRANK_SERVER?.trim() || DEFAULT_SERVER), token: config.token, from: "config" };
  }
  return { server: normalizeServerUrl(env.TOKENRANK_SERVER?.trim() || config.server || DEFAULT_SERVER), token: undefined, from: "none" };
}

export function enabledSources(config: CollectorConfig): CollectorSource[] {
  return COLLECTOR_SOURCES.filter((s) => config.sources[s].enabled);
}
