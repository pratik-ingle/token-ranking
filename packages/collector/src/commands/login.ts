import { ApiError, TokenRankClient } from "../api";
import {
  DEFAULT_SERVER,
  isLoopbackUrl,
  loadConfig,
  normalizeServerUrl,
  saveConfig,
  type CollectorConfig,
} from "../config";
import type { CliIO } from "../io";
import { detectLocalSources, sourceLabel } from "../sources";
import { parse, optString, UsageError } from "./args";
import { runSyncAndReport } from "./sync";

export const LOGIN_HELP = `Usage: tokenrank-collector login [--server <url>] [--no-sync] [--no-browser]

Sign in with a one-time code (device flow), enable the local sources found on
this machine (Claude Code, Codex CLI) and run the first sync.

  --server <url>   TokenRank server (default: $TOKENRANK_SERVER, the saved server, or ${DEFAULT_SERVER})
  --no-sync        Do not run the first sync
  --no-browser     Do not try to open the browser
`;

export async function loginCommand(args: string[], io: CliIO): Promise<number> {
  const { values } = parse(args, {
    server: { type: "string" },
    "no-sync": { type: "boolean" },
    "no-browser": { type: "boolean" },
  });
  if (values.help) {
    io.stdout(LOGIN_HELP);
    return 0;
  }
  const config = await loadConfig(io.env);
  const server = normalizeServerUrl(optString(values.server) ?? io.env.TOKENRANK_SERVER?.trim() ?? config.server ?? DEFAULT_SERVER);
  if (!server.startsWith("https://") && !isLoopbackUrl(server)) {
    io.stderr(`warning: ${server} is plain http; your token will travel unencrypted.\n`);
  }
  const client = new TokenRankClient({ server, fetch: io.fetch, sleep: io.sleep });
  const code = await client.deviceCode("collector");

  io.stdout(
    [
      `Sign in to TokenRank (${server})`,
      "",
      `  1. Open:  ${code.verification_uri_complete || code.verification_uri}`,
      `  2. Check the code matches:  ${code.user_code}`,
      "",
      "Waiting for approval in the browser… (Ctrl-C to cancel)",
      "",
    ].join("\n"),
  );
  if (!values["no-browser"]) io.openBrowser(code.verification_uri_complete || code.verification_uri);

  const nowMs = () => (io.now ? io.now().getTime() : Date.now());
  const deadline = nowMs() + Math.max(1, code.expires_in) * 1000;
  let interval = Math.max(1, code.interval || 5);
  let token: { access_token: string; username: string; timezone: string } | null = null;
  // RFC 8628 polling: wait `interval`, back off by 5 s on slow_down.
  while (nowMs() < deadline) {
    await io.sleep(interval * 1000);
    const res = await client.deviceToken(code.device_code);
    if (res.ok) {
      token = res.token;
      break;
    }
    if (res.error === "authorization_pending") continue;
    if (res.error === "slow_down") {
      interval += 5;
      continue;
    }
    if (res.error === "expired_token") throw new ApiError("The login code expired. Run `tokenrank-collector login` again.", "http_error", 400);
    if (res.error === "access_denied") throw new ApiError("Login was denied in the browser.", "http_error", 400);
    throw new ApiError(`Login failed (${res.error}). Run \`tokenrank-collector login\` again.`, "http_error", 400);
  }
  if (!token) throw new ApiError("The login code expired. Run `tokenrank-collector login` again.", "http_error", null);

  // A different account or server: forget per-source sync state so the
  // new account gets a full first sync.
  const switched = config.server !== server || (config.username !== undefined && config.username !== token.username);
  const next: CollectorConfig = {
    ...config,
    server,
    token: token.access_token,
    username: token.username,
    timezone: token.timezone,
    lastSync: switched ? {} : config.lastSync,
  };
  const detected = await detectLocalSources(io.env, next);
  const newlyEnabled: string[] = [];
  for (const s of detected) {
    if (!next.sources[s].enabled) {
      next.sources[s] = { ...next.sources[s], enabled: true };
      newlyEnabled.push(sourceLabel(s));
    }
  }
  const file = await saveConfig(next, io.env);
  io.stdout(`Logged in as @${token.username} (timezone ${token.timezone}). Token saved to ${file}\n`);
  if (newlyEnabled.length > 0) io.stdout(`Enabled local sources: ${newlyEnabled.join(", ")}\n`);
  else if (detected.length === 0) {
    io.stdout("No Claude Code or Codex CLI logs found on this machine. See `tokenrank-collector sources` for other options.\n");
  }

  if (values["no-sync"]) {
    io.stdout("Skipping the first sync (--no-sync). Run `tokenrank-collector sync` when ready.\n");
    return 0;
  }
  io.stdout("\nRunning the first sync…\n");
  return runSyncAndReport({}, io);
}

export function assertNoPositionals(positionals: string[], command: string): void {
  if (positionals.length > 0) throw new UsageError(`unexpected argument for ${command}: ${positionals[0]}`);
}
