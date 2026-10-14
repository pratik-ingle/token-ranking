import { isDateString } from "@tokenrank/shared";
import { TokenRankClient, isAuthError } from "../api";
import { COLLECTOR_SOURCES, isCollectorSource, loadConfig, resolveAuth, type CollectorSource } from "../config";
import { formatRank, formatSyncSummary } from "../format";
import type { CliIO } from "../io";
import { runSync, type RunSyncOptions } from "../sync";
import { parse, optString, optStrings, UsageError } from "./args";

export const SYNC_HELP = `Usage: tokenrank-collector sync [--dry-run] [--since YYYY-MM-DD] [--source a,b] [--full]

Read the enabled sources, aggregate them into daily rows and upload them.

  --dry-run            Upload nothing. STDOUT gets exactly the request bodies that
                       would be POSTed to /api/v1/usage, as ONE JSON array whose
                       elements are the request bodies (each a JSON array of at
                       most 1000 rows): [[row, …], [row, …]]. "[]" = nothing to send.
                       The human-readable summary goes to STDERR.
  --since YYYY-MM-DD   Re-aggregate and upload every day from this date on
  --source a,b         Only these sources (${COLLECTOR_SOURCES.join(", ")})
  --full               Ignore the last-sync marker and re-read everything still on disk
  --claude-dir DIR     Claude Code config/projects dir (repeatable; overrides defaults)
  --codex-home DIR     Codex home (default: $CODEX_HOME or ~/.codex)
`;

export async function syncCommand(args: string[], io: CliIO): Promise<number> {
  const { values, positionals } = parse(args, {
    "dry-run": { type: "boolean" },
    since: { type: "string" },
    source: { type: "string", multiple: true },
    full: { type: "boolean" },
    "claude-dir": { type: "string", multiple: true },
    "codex-home": { type: "string" },
  });
  if (values.help) {
    io.stdout(SYNC_HELP);
    return 0;
  }
  if (positionals.length > 0) throw new UsageError(`unexpected argument: ${positionals[0]}`);
  const since = optString(values.since);
  if (since !== undefined && !isDateString(since)) throw new UsageError(`--since must be a date like 2026-01-31, got "${since}"`);
  let sources: CollectorSource[] | undefined;
  const rawSources = optStrings(values.source).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
  if (rawSources.length > 0) {
    for (const s of rawSources) {
      if (!isCollectorSource(s)) throw new UsageError(`unknown source "${s}" (expected one of: ${COLLECTOR_SOURCES.join(", ")})`);
    }
    sources = [...new Set(rawSources)] as CollectorSource[];
  }
  return runSyncAndReport(
    {
      dryRun: values["dry-run"] === true,
      since,
      full: values.full === true,
      sources,
      claudeDirs: optStrings(values["claude-dir"]).length > 0 ? optStrings(values["claude-dir"]) : undefined,
      codexHome: optString(values["codex-home"]),
    },
    io,
  );
}

export async function runSyncAndReport(opts: RunSyncOptions, io: CliIO): Promise<number> {
  const summary = await runSync({
    ...opts,
    env: io.env,
    fetch: io.fetch,
    now: io.now,
    sleep: io.sleep,
    log: (line) => io.stderr(`${line}\n`),
  });

  if (summary.dryRun) {
    // Machine-readable: exactly the POST bodies, nothing else on stdout.
    io.stdout(`${JSON.stringify(summary.payloads, null, 2)}\n`);
    io.stderr(`\n${formatSyncSummary(summary)}\n`);
    io.stderr(
      `Dry run: nothing was uploaded. STDOUT holds ${summary.payloads.length} request bod${summary.payloads.length === 1 ? "y" : "ies"} ` +
        `(${summary.totals.rows} rows) exactly as they would be POSTed to ${summary.server}/api/v1/usage.\n`,
    );
    return summary.ok ? 0 : 1;
  }

  io.stdout(`${formatSyncSummary(summary)}\n`);
  const config = await loadConfig(io.env);
  const auth = resolveAuth(config, io.env);
  if (auth.token) {
    try {
      const client = new TokenRankClient({ server: auth.server, token: auth.token, fetch: io.fetch, sleep: io.sleep, maxRetries: 1 });
      const rank = await client.meRank(true);
      io.stdout(`\nYour rank:\n${formatRank(rank)}\n`);
      io.stdout("Rankings refresh periodically on the server, so a fresh upload can take a little while to show up.\n");
    } catch (err) {
      if (isAuthError(err)) throw err;
      io.stderr(`warning: could not fetch your rank (${(err as Error).message})\n`);
    }
  }
  return summary.ok ? 0 : 1;
}
