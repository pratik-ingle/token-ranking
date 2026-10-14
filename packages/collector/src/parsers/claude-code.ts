import { UsageAccumulator, localDate, type UsageRow } from "@tokenrank/shared";
import { compileFieldSpec, count, extractFields, getPath, str } from "../json-extract";
import { readLines, walkFiles } from "../files";
import type { LocalParseOptions, LocalParseResult, TokenCounts } from "./types";

/**
 * Claude Code transcripts: `<config root>/projects/<project>/<session>.jsonl`
 * (and `<session>/subagents/agent-*.jsonl`). Each assistant API response is
 * written as one line PER CONTENT BLOCK, all sharing message.id + requestId,
 * with usage repeated (the last line may carry the final output_tokens).
 *
 * The ONLY fields ever read are listed here. Everything else on the line —
 * message.content (text, thinking, tool calls), cwd, gitBranch, uuid, … — is
 * skipped by the selective extractor without being decoded.
 */
const USAGE_FIELDS = [
  "input_tokens",
  "output_tokens",
  "cache_creation_input_tokens",
  "cache_read_input_tokens",
  "cache_creation.ephemeral_5m_input_tokens",
  "cache_creation.ephemeral_1h_input_tokens",
];

export const CLAUDE_CODE_FIELD_PATHS: readonly string[] = [
  "type",
  "timestamp",
  "requestId",
  "sessionId",
  "isSidechain",
  "isApiErrorMessage",
  "message.id",
  "message.model",
  ...USAGE_FIELDS.map((f) => `message.usage.${f}`),
  "message.usage.iterations[].type",
  "message.usage.iterations[].model",
  ...USAGE_FIELDS.map((f) => `message.usage.iterations[].${f}`),
  // Defensive: tolerate iteration items that nest their counters under `usage`.
  ...USAGE_FIELDS.map((f) => `message.usage.iterations[].usage.${f}`),
];

const SPEC = compileFieldSpec(CLAUDE_CODE_FIELD_PATHS, { maxStringBytes: 512 });
const ASSISTANT_NEEDLE = Buffer.from('"assistant"');

export function isClaudeTranscriptName(name: string): boolean {
  return name.endsWith(".jsonl") && !name.startsWith(".orphaned-");
}

export interface ClaudeCodeEvent extends TokenCounts {
  timestampMs: number;
  model: string;
  kind: "message" | "advisor";
}

interface AdvisorUsage extends TokenCounts {
  model: string;
}

interface Entry extends TokenCounts {
  messageId: string | undefined;
  timestampMs: number;
  model: string;
  /** True while every line seen for this key was a sidechain line. */
  sidechainOnly: boolean;
  advisors: AdvisorUsage[];
}

export interface ClaudeCodeStats {
  files: number;
  filesParsed: number;
  filesSkippedByMtime: number;
  lines: number;
  assistantLines: number;
  malformedLines: number;
  oversizedLines: number;
  skippedSynthetic: number;
  skippedApiError: number;
  skippedNoUsage: number;
  skippedBadTimestamp: number;
  duplicateLines: number;
  sidechainReplaysDropped: number;
  messages: number;
  advisorEvents: number;
}

function newStats(): ClaudeCodeStats {
  return {
    files: 0,
    filesParsed: 0,
    filesSkippedByMtime: 0,
    lines: 0,
    assistantLines: 0,
    malformedLines: 0,
    oversizedLines: 0,
    skippedSynthetic: 0,
    skippedApiError: 0,
    skippedNoUsage: 0,
    skippedBadTimestamp: 0,
    duplicateLines: 0,
    sidechainReplaysDropped: 0,
    messages: 0,
    advisorEvents: 0,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** input excludes cache; cache_write prefers the nested 5m/1h split when present. */
export function claudeUsageCounts(usage: Record<string, unknown>): TokenCounts {
  const cc = usage.cache_creation;
  const nested =
    isObject(cc) &&
    (typeof cc.ephemeral_5m_input_tokens === "number" || typeof cc.ephemeral_1h_input_tokens === "number");
  return {
    input: count(usage.input_tokens),
    output: count(usage.output_tokens),
    cacheRead: count(usage.cache_read_input_tokens),
    cacheWrite: nested
      ? count((cc as Record<string, unknown>).ephemeral_5m_input_tokens) +
        count((cc as Record<string, unknown>).ephemeral_1h_input_tokens)
      : count(usage.cache_creation_input_tokens),
  };
}

const COUNTER_KEYS = ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "cache_creation"];

/**
 * Advisor sub-inferences (advisor tool): `usage.iterations[]` items with
 * type "advisor_message" carry their own model and counters; top-level usage
 * covers the executor only. Each becomes a separate event under its own model.
 */
function advisorUsages(usage: Record<string, unknown>): AdvisorUsage[] {
  const iterations = usage.iterations;
  if (!Array.isArray(iterations)) return [];
  const out: AdvisorUsage[] = [];
  for (const it of iterations) {
    if (!isObject(it) || it.type !== "advisor_message") continue;
    const hasOwn = COUNTER_KEYS.some((k) => k in it);
    const src = !hasOwn && isObject(it.usage) ? it.usage : it;
    out.push({ model: str(it.model) ?? "unknown", ...claudeUsageCounts(src) });
  }
  return out;
}

function maxCounts<T extends TokenCounts>(into: T, from: TokenCounts): void {
  into.input = Math.max(into.input, from.input);
  into.output = Math.max(into.output, from.output);
  into.cacheRead = Math.max(into.cacheRead, from.cacheRead);
  into.cacheWrite = Math.max(into.cacheWrite, from.cacheWrite);
}

/**
 * Stateful, file-order-independent parser. Feed it lines (or files), then
 * read deduplicated events or daily rows. Dedupe state spans every file
 * added to the same instance.
 */
export class ClaudeCodeParser {
  private readonly entries = new Map<string, Entry>();
  private readonly nonSidechainIds = new Set<string>();
  readonly stats: ClaudeCodeStats = newStats();

  addLine(line: string | Uint8Array): void {
    this.stats.lines++;
    const buf = typeof line === "string" ? Buffer.from(line, "utf8") : Buffer.from(line.buffer, line.byteOffset, line.byteLength);
    // Cheap pre-filter: every assistant entry contains the JSON string "assistant".
    if (buf.indexOf(ASSISTANT_NEEDLE) < 0) return;
    const obj = extractFields(buf, SPEC);
    if (!obj) {
      this.stats.malformedLines++;
      return;
    }
    if (obj.type !== "assistant") return;
    this.stats.assistantLines++;
    if (obj.isApiErrorMessage === true) {
      this.stats.skippedApiError++;
      return;
    }
    const model = str(getPath(obj, "message", "model"));
    if (model === "<synthetic>") {
      this.stats.skippedSynthetic++;
      return;
    }
    const usage = getPath(obj, "message", "usage");
    if (!isObject(usage)) {
      this.stats.skippedNoUsage++;
      return;
    }
    const timestamp = str(obj.timestamp);
    const timestampMs = timestamp ? Date.parse(timestamp) : Number.NaN;
    if (!Number.isFinite(timestampMs)) {
      this.stats.skippedBadTimestamp++;
      return;
    }
    const messageId = str(getPath(obj, "message", "id"));
    const requestId = str(obj.requestId);
    const sessionId = str(obj.sessionId) ?? "";
    const sidechain = obj.isSidechain === true;

    let key: string;
    if (messageId && requestId) key = `${messageId}:${requestId}`;
    else if (messageId) key = `${messageId}:${sessionId}${messageId.startsWith("msg_") ? "" : `:${timestamp}`}`;
    else key = `noid:${sessionId}:${timestamp}`;

    if (messageId && !sidechain) this.nonSidechainIds.add(messageId);

    const counts = claudeUsageCounts(usage);
    const advisors = advisorUsages(usage);
    const existing = this.entries.get(key);
    if (!existing) {
      this.entries.set(key, {
        messageId,
        timestampMs,
        model: model ?? "unknown",
        sidechainOnly: sidechain,
        advisors,
        ...counts,
      });
      return;
    }
    // Same API response seen again (another content block, or a copy in
    // another file): keep the per-field maximum.
    this.stats.duplicateLines++;
    maxCounts(existing, counts);
    existing.timestampMs = Math.min(existing.timestampMs, timestampMs);
    if (existing.model === "unknown" && model) existing.model = model;
    existing.sidechainOnly &&= sidechain;
    for (let i = 0; i < advisors.length; i++) {
      const a = advisors[i]!;
      const e = existing.advisors[i];
      if (!e) existing.advisors[i] = a;
      else {
        maxCounts(e, a);
        if (e.model === "unknown") e.model = a.model;
      }
    }
  }

  async addFile(filePath: string): Promise<void> {
    this.stats.filesParsed++;
    await readLines(filePath, (l) => this.addLine(l), { onOversized: () => this.stats.oversizedLines++ });
  }

  /** Deduplicated usage events (one per API response, plus advisor sub-inferences). */
  events(): ClaudeCodeEvent[] {
    const out: ClaudeCodeEvent[] = [];
    let messages = 0;
    let advisorEvents = 0;
    let replays = 0;
    for (const e of this.entries.values()) {
      // A sidechain replay of a message the parent session also logged.
      if (e.sidechainOnly && e.messageId && this.nonSidechainIds.has(e.messageId)) {
        replays++;
        continue;
      }
      messages++;
      out.push({
        kind: "message",
        timestampMs: e.timestampMs,
        model: e.model,
        input: e.input,
        output: e.output,
        cacheRead: e.cacheRead,
        cacheWrite: e.cacheWrite,
      });
      for (const a of e.advisors) {
        advisorEvents++;
        out.push({
          kind: "advisor",
          timestampMs: e.timestampMs,
          model: a.model,
          input: a.input,
          output: a.output,
          cacheRead: a.cacheRead,
          cacheWrite: a.cacheWrite,
        });
      }
    }
    this.stats.messages = messages;
    this.stats.advisorEvents = advisorEvents;
    this.stats.sidechainReplaysDropped = replays;
    return out;
  }

  /** Daily rows in the user's timezone; days before `fromDate` are dropped. */
  toRows(timeZone: string, fromDate?: string): UsageRow[] {
    const acc = new UsageAccumulator();
    for (const ev of this.events()) {
      const date = localDate(ev.timestampMs, timeZone);
      if (fromDate && date < fromDate) continue;
      acc.add({
        date,
        source: "claude_code",
        model: ev.model,
        category: "coding",
        input_tokens: ev.input,
        output_tokens: ev.output,
        cache_read_tokens: ev.cacheRead,
        cache_write_tokens: ev.cacheWrite,
        request_count: 1,
      });
    }
    return acc.toRows();
  }
}

/**
 * Parse every transcript under the given `projects` directories. Files whose
 * mtime is older than `minMtimeMs` cannot contain events at/after that instant
 * (transcripts are append-only), so they are not opened at all.
 */
export async function parseClaudeCode(scanDirs: readonly string[], opts: LocalParseOptions): Promise<LocalParseResult<ClaudeCodeStats>> {
  const parser = new ClaudeCodeParser();
  const seen = new Set<string>();
  for (const dir of scanDirs) {
    const files = await walkFiles(dir, isClaudeTranscriptName);
    for (const f of files) {
      if (seen.has(f.path)) continue;
      seen.add(f.path);
      parser.stats.files++;
      if (opts.minMtimeMs !== undefined && f.mtimeMs < opts.minMtimeMs) {
        parser.stats.filesSkippedByMtime++;
        continue;
      }
      try {
        await parser.addFile(f.path);
      } catch {
        opts.onWarning?.(`could not read a Claude Code transcript (skipped)`);
      }
    }
  }
  const rows = parser.toRows(opts.timeZone, opts.fromDate);
  return { rows, stats: parser.stats, warnings: [] };
}
