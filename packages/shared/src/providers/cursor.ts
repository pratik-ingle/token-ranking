import { UsageAccumulator } from "../aggregate";
import { addDays, localDate, startOfLocalDay } from "../dates";
import type { AggregatedUsageRow } from "../schemas";
import { requestJson } from "./http";
import type { ProviderOptions, UsageIntegration } from "./types";

/**
 * Cursor Admin API (team admin key, HTTP Basic with the key as username).
 * Verified 2026-10-14 against cursor.com/docs/account/teams/admin-api:
 *   POST https://api.cursor.com/teams/filtered-usage-events
 *   { startDate, endDate (epoch ms, inclusive), page, pageSize (max 1000), email? }
 *   → { usageEvents[{ timestamp (string ms), model, isTokenBasedCall,
 *        tokenUsage{inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens} }],
 *      pagination{ hasNextPage } }
 * The key covers the WHOLE team, so we filter by the user's own email
 * (stored only in local config / the encrypted credential, never uploaded)
 * unless the user explicitly opts into team-wide totals.
 * Identifying fields in events (userEmail, conversationId, …) are never read.
 */
export const CURSOR_BASE_URL = "https://api.cursor.com";
const WINDOW_DAYS = 30;

interface CursorEvent {
  timestamp?: string | number;
  model?: string | null;
  isTokenBasedCall?: boolean;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheWriteTokens?: number;
    cacheReadTokens?: number;
  } | null;
}

interface CursorPage {
  usageEvents?: CursorEvent[];
  pagination?: { hasNextPage?: boolean; currentPage?: number; numPages?: number };
}

export interface CursorOptions extends ProviderOptions {
  adminKey: string;
  /** Only count events for this team member. Required unless teamWide. */
  email?: string;
  teamWide?: boolean;
  baseUrl?: string;
}

function base64(s: string): string {
  if (typeof btoa === "function") return btoa(s);
  return Buffer.from(s, "utf8").toString("base64");
}

export function createCursorIntegration(opts: CursorOptions): UsageIntegration {
  if (!opts.email && !opts.teamWide) {
    throw new Error(
      "Cursor Admin API keys cover the whole team. Set your Cursor account email (kept locally, used only as a filter) or opt into team-wide totals.",
    );
  }
  const base = opts.baseUrl ?? CURSOR_BASE_URL;
  const headers = {
    Authorization: `Basic ${base64(`${opts.adminKey}:`)}`,
    "User-Agent": opts.userAgent ?? "tokenrank",
  };

  return {
    source: "cursor",
    async fetchUsage(since: Date, until: Date): Promise<AggregatedUsageRow[]> {
      const firstDay = localDate(since, opts.timeZone);
      const acc = new UsageAccumulator();
      let windowStart = startOfLocalDay(firstDay, opts.timeZone);
      const end = until.getTime();
      while (windowStart <= end) {
        const windowEnd = Math.min(end, startOfLocalDay(addDays(localDate(windowStart, opts.timeZone), WINDOW_DAYS), opts.timeZone) - 1);
        let page = 1;
        for (;;) {
          const body: Record<string, unknown> = { startDate: windowStart, endDate: windowEnd, page, pageSize: 1000 };
          if (opts.email) body.email = opts.email;
          const { body: res } = await requestJson<CursorPage>("POST", `${base}/teams/filtered-usage-events`, headers, body, {
            fetch: opts.fetch,
          });
          for (const ev of res.usageEvents ?? []) {
            const ts = Number(ev.timestamp);
            if (!Number.isFinite(ts)) continue;
            const date = localDate(ts, opts.timeZone);
            if (date < firstDay) continue;
            const t = ev.isTokenBasedCall === false ? null : ev.tokenUsage;
            acc.add({
              date,
              source: "cursor",
              model: ev.model ?? "unknown",
              category: "coding",
              input_tokens: t?.inputTokens ?? 0,
              output_tokens: t?.outputTokens ?? 0,
              cache_write_tokens: t?.cacheWriteTokens ?? 0,
              cache_read_tokens: t?.cacheReadTokens ?? 0,
              request_count: 1,
            });
          }
          opts.onProgress?.(`cursor events page ${page}: ${res.usageEvents?.length ?? 0} events`);
          if (!res.pagination?.hasNextPage) break;
          page++;
        }
        windowStart = windowEnd + 1;
      }
      return acc.toRows().map((r) => ({ ...r, trust_level: opts.trust }));
    },
  };
}
