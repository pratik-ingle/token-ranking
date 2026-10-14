import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  ApiError,
  TokenRankClient,
  loadConfig,
  resolveAuth,
  runSync,
  type Env,
  type SyncSummary,
} from "tokenrank-collector";
import { version } from "../package.json";
import { rankText, statsText, syncStructured, syncText } from "./format";

export const TOOL_NAMES = ["get_my_rank", "get_my_stats", "sync_now"] as const;

export interface TokenRankMcpOptions {
  /** Environment (TOKENRANK_HOME, TOKENRANK_TOKEN, TOKENRANK_SERVER, …). */
  env?: Env;
  /** fetch for the TokenRank server and provider APIs (tests inject a mock). */
  fetch?: typeof fetch;
  /** Diagnostics. Must never write to stdout (that is the MCP channel). */
  log?: (message: string) => void;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

const LOGIN_MESSAGE =
  "You're not logged in to TokenRank. In a terminal, run `npx tokenrank-collector login --server https://<your TokenRank host>`, then try again.";

const INSTRUCTIONS = `TokenRank is a privacy-first leaderboard for AI token usage.
Tools: get_my_rank (rank per time window), get_my_stats (totals, streaks, top sources/models), sync_now (upload today's local usage aggregates).
None of the tools accept or send conversation content: only daily token counts per model ever leave the machine.`;

function textResult(text: string, structured?: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text }], ...(structured ? { structuredContent: structured } : {}) };
}

function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}

function toErrorResult(err: unknown): CallToolResult {
  if (err instanceof ApiError) {
    if (err.code === "not_logged_in" || err.code === "unauthorized") {
      return errorResult(err.code === "unauthorized" ? `${err.message}\n${LOGIN_MESSAGE}` : LOGIN_MESSAGE);
    }
    return errorResult(err.message);
  }
  return errorResult(`TokenRank error: ${err instanceof Error ? err.message : String(err)}`);
}

/**
 * Build the TokenRank MCP server. Tools take no free-text input (only an
 * optional boolean each), the server never requests sampling and never
 * reads client resources, so no conversation content can reach TokenRank.
 */
export function createTokenRankMcpServer(opts: TokenRankMcpOptions = {}): McpServer {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((m: string) => process.stderr.write(`[tokenrank-mcp] ${m}\n`));

  const server = new McpServer(
    { name: "tokenrank", title: "TokenRank", version },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );

  /** Re-read on every call so a `login` done after the server started is picked up. */
  async function client(): Promise<TokenRankClient | null> {
    const config = await loadConfig(env);
    const auth = resolveAuth(config, env);
    if (!auth.token) return null;
    return new TokenRankClient({ server: auth.server, token: auth.token, fetch: opts.fetch, sleep: opts.sleep, maxRetries: 2 });
  }

  server.registerTool(
    "get_my_rank",
    {
      title: "Get my TokenRank rank",
      description:
        "Your current TokenRank leaderboard rank for each time window (today, 7 days, 30 days, this year, all time), with token totals and percentile.",
      inputSchema: z.strictObject({
        include_cache: z
          .boolean()
          .optional()
          .describe("Count cache read/write tokens toward the total (default true)."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async ({ include_cache }) => {
      try {
        const c = await client();
        if (!c) return errorResult(LOGIN_MESSAGE);
        const rank = await c.meRank(include_cache ?? true);
        return textResult(rankText(rank), rank as unknown as Record<string, unknown>);
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  server.registerTool(
    "get_my_stats",
    {
      title: "Get my TokenRank stats",
      description: "Your TokenRank totals (input/output/cache tokens, requests), streaks, and top sources, categories and models.",
      inputSchema: z.strictObject({}),
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async () => {
      try {
        const c = await client();
        if (!c) return errorResult(LOGIN_MESSAGE);
        const stats = await c.meStats();
        return textResult(statsText(stats), stats as unknown as Record<string, unknown>);
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  let inFlight: Promise<SyncSummary> | null = null;
  server.registerTool(
    "sync_now",
    {
      title: "Sync my usage to TokenRank now",
      description:
        "Read token counts from this machine's AI tools (as enabled in the tokenrank-collector config), aggregate them per day and model, and upload them. Only daily counts are sent — never prompts, responses or file contents. Set dry_run to see the counts without uploading.",
      inputSchema: z.strictObject({
        dry_run: z.boolean().optional().describe("Compute the summary but upload nothing (default false)."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ dry_run }) => {
      try {
        if (inFlight) {
          log("sync already running; waiting for it");
          await inFlight.catch(() => undefined);
        }
        const run = runSync({ env, fetch: opts.fetch, now: opts.now, sleep: opts.sleep, dryRun: dry_run === true, log });
        inFlight = run;
        const summary = await run.finally(() => {
          if (inFlight === run) inFlight = null;
        });
        // Counts only — never the row payloads.
        return { ...textResult(syncText(summary), syncStructured(summary)), ...(summary.ok ? {} : { isError: true }) };
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  return server;
}
