import {
  MAX_ROWS_PER_REQUEST,
  MIN_USAGE_DATE,
  addDays,
  chunkRows,
  ingestPayloadSchema,
  isValidTimeZone,
  localDate,
  startOfLocalDay,
  toUploadRow,
  totalTokens,
  type IngestResponse,
  type UsageRow,
} from "@tokenrank/shared";
import { orgFingerprintInput } from "@tokenrank/shared/providers";
import { ApiError, NotLoggedInError, TokenRankClient, isAuthError } from "./api";
import {
  enabledSources,
  isAdminSource,
  loadConfig,
  resolveAuth,
  updateConfig,
  type CollectorConfig,
  type CollectorSource,
} from "./config";
import { parseClaudeCode } from "./parsers/claude-code";
import { parseCodex } from "./parsers/codex";
import { claudeScanDirs, codexHome, type Env } from "./paths";
import { createAdminIntegration, detectLocalSources, sourceLabel } from "./sources";

const DAY_MS = 86_400_000;
/** Admin APIs: how far back the first sync (or --full) goes. */
export const ADMIN_FIRST_SYNC_DAYS = 90;
/** Admin APIs: re-fetch this much before the last sync for late-arriving data. */
export const ADMIN_OVERLAP_DAYS = 2;

export interface RunSyncOptions {
  env?: Env;
  /** Use this config instead of loading it from TOKENRANK_HOME. */
  config?: CollectorConfig;
  /** Build the payloads but upload nothing and change no state. */
  dryRun?: boolean;
  /** Re-aggregate and upload from this local date (YYYY-MM-DD). */
  since?: string;
  /** Ignore lastSync: re-read everything still on disk. */
  full?: boolean;
  /** Restrict to these sources (default: the enabled ones). */
  sources?: CollectorSource[];
  claudeDirs?: string[];
  codexHome?: string;
  /** fetch used for the TokenRank server and the provider APIs. */
  fetch?: typeof fetch;
  now?: () => Date;
  /** Progress / warnings (human-readable). Never called with row data. */
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

export interface SourceSummary {
  source: CollectorSource;
  label: string;
  status: "ok" | "error";
  error?: string;
  /** First local date included in this run (null = everything on disk). */
  affectedFrom: string | null;
  days: number;
  rows: number;
  totalTokens: number;
  requests: number;
  chunks: number;
  uploaded: boolean;
  ingest?: IngestResponse;
  heartbeat?: "active" | "duplicate" | "failed";
  stats?: Record<string, number>;
  warnings: string[];
}

export interface SyncSummary {
  dryRun: boolean;
  server: string;
  username?: string;
  timeZone: string;
  startedAt: string;
  sources: SourceSummary[];
  /** Exactly the request bodies POSTed (or that would be, in a dry run). */
  payloads: UsageRow[][];
  totals: { rows: number; totalTokens: number; requests: number; days: number };
  ok: boolean;
}

function systemTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && isValidTimeZone(tz) ? tz : "UTC";
  } catch {
    return "UTC";
  }
}

function sumIngest(a: IngestResponse | undefined, b: IngestResponse): IngestResponse {
  if (!a) return { ...b };
  return {
    accepted: a.accepted + b.accepted,
    inserted: a.inserted + b.inserted,
    updated: a.updated + b.updated,
    skipped_verified: a.skipped_verified + b.skipped_verified,
    flagged: a.flagged + b.flagged,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Collect, aggregate and (unless dry-run) upload usage for the enabled
 * sources. Each uploaded day is complete: local sources re-read every file
 * that can contain events on or after the first affected day, and admin
 * integrations round their window down to local midnight.
 */
export async function runSync(opts: RunSyncOptions = {}): Promise<SyncSummary> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? (() => {});
  const now = opts.now?.() ?? new Date();
  const startedAt = now.toISOString();
  const dryRun = !!opts.dryRun;
  const persist = !dryRun && !opts.config;
  const config = opts.config ?? (await loadConfig(env));
  const auth = resolveAuth(config, env);
  if (!auth.token && !dryRun) throw new NotLoggedInError();

  const client = auth.token
    ? new TokenRankClient({ server: auth.server, token: auth.token, fetch: opts.fetch, sleep: opts.sleep })
    : null;

  // Refresh the timezone (and username) from the server at the start of each sync.
  let timeZone = config.timezone;
  let username = config.username;
  let timeZoneChanged = false;
  if (client) {
    try {
      const me = await client.me();
      username = me.username || username;
      if (me.timezone && isValidTimeZone(me.timezone)) {
        if (config.timezone && config.timezone !== me.timezone) timeZoneChanged = true;
        timeZone = me.timezone;
      }
      if (persist && auth.from === "config" && (config.timezone !== timeZone || config.username !== username)) {
        await updateConfig(env, (c) => {
          c.timezone = timeZone;
          c.username = username;
        });
      }
      config.timezone = timeZone;
      config.username = username;
    } catch (err) {
      if (isAuthError(err)) throw err;
      if (!dryRun && !timeZone) throw err;
      log(`warning: could not refresh your timezone from the server (${errorMessage(err)}); using ${timeZone ?? "the system timezone"}`);
    }
  }
  if (!timeZone || !isValidTimeZone(timeZone)) {
    timeZone = systemTimeZone();
    if (dryRun) log(`note: not logged in; bucketing days in the system timezone (${timeZone})`);
  }
  if (timeZoneChanged) {
    log(`note: your timezone changed to ${timeZone}; re-reading all local history so days are re-bucketed`);
  }

  let selected: CollectorSource[] = opts.sources ?? enabledSources(config);
  if (!opts.sources && selected.length === 0 && dryRun) {
    selected = await detectLocalSources(env, config);
    if (selected.length > 0) log(`note: no sources enabled; dry run uses detected local sources: ${selected.join(", ")}`);
  }
  if (selected.length === 0) log("No sources enabled. Run `tokenrank-collector sources` to see what can be enabled.");

  const today = localDate(now, timeZone);
  const maxDate = addDays(today, 1);
  const summary: SyncSummary = {
    dryRun,
    server: auth.server,
    username,
    timeZone,
    startedAt,
    sources: [],
    payloads: [],
    totals: { rows: 0, totalTokens: 0, requests: 0, days: 0 },
    ok: true,
  };
  const allDays = new Set<string>();

  for (const source of selected) {
    const s: SourceSummary = {
      source,
      label: sourceLabel(source),
      status: "ok",
      affectedFrom: null,
      days: 0,
      rows: 0,
      totalTokens: 0,
      requests: 0,
      chunks: 0,
      uploaded: false,
      warnings: [],
    };
    summary.sources.push(s);
    const warn = (m: string) => {
      s.warnings.push(m);
      log(`warning (${source}): ${m}`);
    };
    let orgFingerprint: string | undefined;
    try {
      const last = config.lastSync[source];
      let rows: UsageRow[];
      if (isAdminSource(source)) {
        let since: Date;
        if (opts.since) since = new Date(startOfLocalDay(opts.since, timeZone));
        else if (opts.full || !last) since = new Date(now.getTime() - ADMIN_FIRST_SYNC_DAYS * DAY_MS);
        else since = new Date(Date.parse(last) - ADMIN_OVERLAP_DAYS * DAY_MS);
        s.affectedFrom = localDate(since, timeZone);
        log(`${s.label}: fetching usage since ${s.affectedFrom} from the provider API…`);
        const integration = createAdminIntegration(source, config, env, { timeZone, fetch: opts.fetch, onProgress: (m) => log(`  ${m}`) });
        rows = (await integration.fetchUsage(since, now)).map(toUploadRow);
        if (!dryRun && integration.identify) {
          try {
            const { orgId } = await integration.identify();
            // Only the sha256 leaves this function; the raw org id is dropped here.
            if (orgId) orgFingerprint = await orgFingerprintInput(source, orgId);
          } catch {
            warn("could not identify the provider organization (heartbeat sent without fingerprint)");
          }
        }
      } else {
        let affectedFrom: string | null;
        if (opts.since) affectedFrom = opts.since;
        else if (opts.full || !last || timeZoneChanged) affectedFrom = null;
        else affectedFrom = addDays(localDate(last, timeZone), -1);
        s.affectedFrom = affectedFrom;
        const parseOpts = {
          timeZone,
          fromDate: affectedFrom ?? undefined,
          // A file holding an event at time t was modified at/after t.
          minMtimeMs: affectedFrom ? startOfLocalDay(affectedFrom, timeZone) : undefined,
          onWarning: warn,
        };
        if (source === "claude_code") {
          const dirs = await claudeScanDirs(env, opts.claudeDirs ?? config.sources.claude_code.paths);
          if (dirs.length === 0) warn("no Claude Code projects directory found");
          const res = await parseClaudeCode(dirs, parseOpts);
          rows = res.rows;
          s.stats = { ...res.stats };
          log(
            `${s.label}: read ${res.stats.filesParsed} of ${res.stats.files} transcript files` +
              (affectedFrom ? ` (others unchanged since before ${affectedFrom})` : "") +
              `, ${res.stats.messages} API responses`,
          );
        } else {
          const home = codexHome(env, opts.codexHome ?? config.sources.codex_cli.home);
          const res = await parseCodex(home, parseOpts);
          rows = res.rows;
          s.stats = { ...res.stats };
          log(
            `${s.label}: read ${res.stats.filesParsed} of ${res.stats.files} rollout files` +
              (affectedFrom ? ` (others unchanged since before ${affectedFrom})` : "") +
              `, ${res.stats.events} token events`,
          );
        }
      }

      // Sanity bounds the server would reject anyway (clock skew, garbage timestamps).
      const before = rows.length;
      rows = rows.filter((r) => r.date >= MIN_USAGE_DATE && r.date <= maxDate);
      if (rows.length !== before) warn(`dropped ${before - rows.length} row(s) dated before ${MIN_USAGE_DATE} or in the future`);

      const days = new Set(rows.map((r) => r.date));
      days.forEach((d) => allDays.add(d));
      s.days = days.size;
      s.rows = rows.length;
      s.totalTokens = rows.reduce((n, r) => n + totalTokens(r), 0);
      s.requests = rows.reduce((n, r) => n + r.request_count, 0);

      const chunks = chunkRows(rows, MAX_ROWS_PER_REQUEST);
      for (const chunk of chunks) {
        const check = ingestPayloadSchema.safeParse(chunk);
        if (!check.success) {
          const issue = check.error.issues[0];
          throw new Error(`internal error: generated rows failed validation (${issue?.path.join(".")}: ${issue?.message})`);
        }
      }
      s.chunks = chunks.length;

      if (dryRun) {
        summary.payloads.push(...chunks);
        continue;
      }
      for (const chunk of chunks) {
        const res = await client!.uploadUsage(chunk);
        s.ingest = sumIngest(s.ingest, res);
        summary.payloads.push(chunk);
      }
      s.uploaded = true;
      // Only after the whole source uploaded successfully.
      if (persist) {
        await updateConfig(env, (c) => {
          c.lastSync[source] = startedAt;
        });
      }
      config.lastSync[source] = startedAt;
      s.heartbeat = await sendHeartbeat(client!, source, "ok", orgFingerprint, warn);
      if (s.heartbeat === "duplicate") {
        warn(
          `this ${s.label} organization is already linked to another TokenRank account; your usage was uploaded but will not count on the public leaderboard`,
        );
      }
    } catch (err) {
      if (isAuthError(err)) throw err;
      s.status = "error";
      s.error = errorMessage(err);
      summary.ok = false;
      log(`error (${source}): ${s.error}`);
      if (!dryRun && client) s.heartbeat = await sendHeartbeat(client, source, "error", orgFingerprint, () => {});
    }
  }

  for (const s of summary.sources) {
    summary.totals.rows += s.rows;
    summary.totals.totalTokens += s.totalTokens;
    summary.totals.requests += s.requests;
  }
  summary.totals.days = allDays.size;
  return summary;
}

async function sendHeartbeat(
  client: TokenRankClient,
  source: CollectorSource,
  status: "ok" | "error",
  orgFingerprint: string | undefined,
  warn: (m: string) => void,
): Promise<"active" | "duplicate" | "failed"> {
  try {
    const res = await client.heartbeat({ source, status, ...(orgFingerprint ? { org_fingerprint: orgFingerprint } : {}) });
    return res.status === "duplicate" ? "duplicate" : "active";
  } catch (err) {
    if (isAuthError(err)) throw err;
    warn(`heartbeat failed (${err instanceof ApiError ? err.message : "error"})`);
    return "failed";
  }
}
