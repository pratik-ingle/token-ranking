import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MeRankResponse, UsageRow } from "@tokenrank/shared";

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
export const CLAUDE_FIXTURE = path.join(FIXTURES, "claude");
export const CODEX_FIXTURE = path.join(FIXTURES, "codex");

/** Distinctive strings planted in fixture content (prompts, paths, branches, emails, …). */
export async function fixtureSecrets(): Promise<string[]> {
  return JSON.parse(await fs.readFile(path.join(FIXTURES, "secrets.json"), "utf8")) as string[];
}

export function expectNoSecrets(text: string, secrets: string[]): void {
  for (const s of secrets) {
    if (text.includes(s)) throw new Error(`privacy violation: output contains fixture content "${s}"`);
  }
  // Also catch partial leaks of any SECRET_* marker.
  if (/SECRET_[A-Z_]+/.test(text)) throw new Error(`privacy violation: output contains ${/SECRET_[A-Z_]+/.exec(text)![0]}`);
}

export interface TestEnv {
  root: string;
  env: Record<string, string>;
  claudeDir: string;
  codexDir: string;
  tokenrankHome: string;
  cleanup: () => Promise<void>;
}

/** Temp HOME / TOKENRANK_HOME / CLAUDE_CONFIG_DIR / CODEX_HOME with copies of the fixtures. */
export async function makeTestEnv(opts: { copyFixtures?: boolean } = {}): Promise<TestEnv> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tokenrank-collector-test-"));
  const home = path.join(root, "home");
  const claudeDir = path.join(root, "claude");
  const codexDir = path.join(root, "codex");
  const tokenrankHome = path.join(root, "tokenrank");
  await fs.mkdir(home, { recursive: true });
  if (opts.copyFixtures !== false) {
    await fs.cp(CLAUDE_FIXTURE, claudeDir, { recursive: true });
    await fs.cp(CODEX_FIXTURE, codexDir, { recursive: true });
  } else {
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(codexDir, { recursive: true });
  }
  return {
    root,
    claudeDir,
    codexDir,
    tokenrankHome,
    env: {
      HOME: home,
      TOKENRANK_HOME: tokenrankHome,
      CLAUDE_CONFIG_DIR: claudeDir,
      CODEX_HOME: codexDir,
      PATH: process.env.PATH ?? "",
    },
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

export async function writeConfig(env: Record<string, string>, config: Record<string, unknown>): Promise<void> {
  await fs.mkdir(env.TOKENRANK_HOME!, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(env.TOKENRANK_HOME!, "config.json"), JSON.stringify(config, null, 2), { mode: 0o600 });
}

export async function readConfigFile(env: Record<string, string>): Promise<Record<string, any>> {
  return JSON.parse(await fs.readFile(path.join(env.TOKENRANK_HOME!, "config.json"), "utf8"));
}

export interface RecordedCall {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface MockServer {
  fetch: typeof fetch;
  calls: RecordedCall[];
  uploads: UsageRow[][];
}

export const RANK_RESPONSE: MeRankResponse = {
  username: "alice",
  visibility: "public",
  include_cache: true,
  windows: [
    { window: "today", total_tokens: 1234, rank: 3, ranked_users: 10, percentile_label: "Top 30%" },
    { window: "30d", total_tokens: 98765, rank: 2, ranked_users: 40, percentile_label: "Top 5%" },
  ],
  profile_url: "http://tokenrank.test/u/alice",
};

/** In-memory fake of the TokenRank API. `routes` can override any path. */
export function mockServer(
  opts: {
    timezone?: string;
    routes?: Record<string, (call: RecordedCall) => Response | Promise<Response>>;
  } = {},
): MockServer {
  const calls: RecordedCall[] = [];
  const uploads: UsageRow[][] = [];
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const call: RecordedCall = {
      method: init?.method ?? "GET",
      url: url.href,
      path: url.pathname,
      headers,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const override = opts.routes?.[url.pathname];
    if (override) return override(call);
    switch (url.pathname) {
      case "/api/v1/me":
        return json(200, { username: "alice", timezone: opts.timezone ?? "UTC", visibility: "public", profile_url: "http://tokenrank.test/u/alice" });
      case "/api/v1/usage": {
        const rows = call.body as UsageRow[];
        uploads.push(rows);
        return json(200, { accepted: rows.length, inserted: rows.length, updated: 0, skipped_verified: 0, flagged: 0 });
      }
      case "/api/v1/integrations/heartbeat":
        return json(200, { status: "active" });
      case "/api/v1/me/rank":
        return json(200, RANK_RESPONSE);
      default:
        return json(404, { error: "not_found" });
    }
  };
  return { fetch: fetchImpl as typeof fetch, calls, uploads };
}

export function capture(): { stdout: string[]; stderr: string[]; io: { stdout: (t: string) => void; stderr: (t: string) => void } } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, io: { stdout: (t) => stdout.push(t), stderr: (t) => stderr.push(t) } };
}

export const noSleep = async (): Promise<void> => {};

export function rowSummary(rows: UsageRow[]): string[] {
  return rows.map(
    (r) =>
      `${r.date} ${r.source} ${r.model} ${r.category} in=${r.input_tokens} out=${r.output_tokens} cr=${r.cache_read_tokens} cw=${r.cache_write_tokens} req=${r.request_count}`,
  );
}
