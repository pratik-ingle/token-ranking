import { SOURCE_LABELS } from "@tokenrank/shared";
import {
  createAnthropicIntegration,
  createCursorIntegration,
  createOpenAIIntegration,
  type OrgIdentity,
  type UsageIntegration,
} from "@tokenrank/shared/providers";
import {
  COLLECTOR_SOURCES,
  type AdminSource,
  type CollectorConfig,
  type CollectorSource,
  type LocalSource,
} from "./config";
import { claudeScanDirs, codexHome, codexScanDirs, type Env } from "./paths";
import { USER_AGENT } from "./api";

export const ADMIN_KEY_ENV: Record<AdminSource, string> = {
  openai_api: "OPENAI_ADMIN_KEY",
  anthropic_api: "ANTHROPIC_ADMIN_KEY",
  cursor: "CURSOR_ADMIN_KEY",
};

export function sourceLabel(source: CollectorSource): string {
  return SOURCE_LABELS[source];
}

export interface LocalDetection {
  detected: boolean;
  /** Directories that would be scanned. */
  dirs: string[];
}

export async function detectLocalSource(
  source: LocalSource,
  env: Env,
  config: CollectorConfig,
  overrides: { claudeDirs?: string[]; codexHome?: string } = {},
): Promise<LocalDetection> {
  if (source === "claude_code") {
    const dirs = await claudeScanDirs(env, overrides.claudeDirs ?? config.sources.claude_code.paths);
    return { detected: dirs.length > 0, dirs };
  }
  const home = codexHome(env, overrides.codexHome ?? config.sources.codex_cli.home);
  const { sessions, archived } = await codexScanDirs(home);
  const dirs = [sessions, archived].filter((d): d is string => !!d);
  return { detected: dirs.length > 0, dirs };
}

export async function detectLocalSources(env: Env, config: CollectorConfig): Promise<LocalSource[]> {
  const out: LocalSource[] = [];
  for (const s of ["claude_code", "codex_cli"] as const) {
    if ((await detectLocalSource(s, env, config)).detected) out.push(s);
  }
  return out;
}

export function adminKeyFor(source: AdminSource, config: CollectorConfig, env: Env): string | undefined {
  return config.sources[source].adminKey || env[ADMIN_KEY_ENV[source]]?.trim() || undefined;
}

export type AdminIntegration = UsageIntegration & { identify?: () => Promise<OrgIdentity> };

/**
 * Build the shared provider integration for an admin-key source. Uploads are
 * always self_reported (the server cannot verify client-side data).
 */
export function createAdminIntegration(
  source: AdminSource,
  config: CollectorConfig,
  env: Env,
  opts: { timeZone: string; fetch?: typeof fetch; onProgress?: (m: string) => void },
): AdminIntegration {
  const adminKey = adminKeyFor(source, config, env);
  if (!adminKey) {
    throw new Error(
      `no admin key for ${sourceLabel(source)}; run \`tokenrank-collector enable ${source}\` or set ${ADMIN_KEY_ENV[source]}`,
    );
  }
  const common = {
    adminKey,
    timeZone: opts.timeZone,
    trust: "self_reported" as const,
    fetch: opts.fetch,
    userAgent: USER_AGENT,
    onProgress: opts.onProgress,
  };
  if (source === "openai_api") return createOpenAIIntegration({ ...common, categoryMap: config.sources.openai_api.categoryMap });
  if (source === "anthropic_api") {
    return createAnthropicIntegration({ ...common, categoryMap: config.sources.anthropic_api.categoryMap });
  }
  const c = config.sources.cursor;
  return createCursorIntegration({ ...common, email: c.email, teamWide: c.teamWide });
}

export const SOURCE_HELP: Record<CollectorSource, string> = {
  claude_code: "Reads token counts from Claude Code transcripts (~/.claude/projects). `tokenrank-collector enable claude_code [--path DIR]`",
  codex_cli: "Reads token counts from Codex CLI rollouts (~/.codex/sessions). `tokenrank-collector enable codex_cli [--home DIR]`",
  openai_api:
    "OpenAI organization Usage API (admin key). `OPENAI_ADMIN_KEY=sk-admin-… tokenrank-collector enable openai_api` (or --key-env NAME, or enter it at the prompt)",
  anthropic_api:
    "Anthropic Usage & Cost Admin API (admin key). `ANTHROPIC_ADMIN_KEY=sk-ant-admin… tokenrank-collector enable anthropic_api` (or --key-env NAME, or enter it at the prompt)",
  cursor:
    "Cursor team Admin API. `CURSOR_ADMIN_KEY=… tokenrank-collector enable cursor --email you@example.com` (email is a local filter only) or `--team-wide`",
};

export { COLLECTOR_SOURCES };
