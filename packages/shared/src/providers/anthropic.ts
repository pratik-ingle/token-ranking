import type { Category } from "../constants";
import { UsageAccumulator } from "../aggregate";
import { localDate, startOfLocalDay } from "../dates";
import type { AggregatedUsageRow } from "../schemas";
import { getJson } from "./http";
import type { OrgIdentity, ProviderOptions, UsageIntegration } from "./types";

/**
 * Anthropic Usage & Cost Admin API (admin key sk-ant-admin..., organizations only).
 * Verified 2026-10-14 against platform.claude.com/docs (usage_report/messages):
 *   GET /v1/organizations/usage_report/messages
 *   starting_at / ending_at (RFC 3339), bucket_width 1d|1h|1m (1h: max limit 168),
 *   group_by[]=model|workspace_id|api_key_id|…, page = next_page.
 * Result fields: uncached_input_tokens, cache_read_input_tokens,
 * cache_creation.{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens},
 * output_tokens. There is no request count, so request_count stays 0.
 */
export const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
export const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicResult {
  model?: string | null;
  workspace_id?: string | null;
  api_key_id?: string | null;
  uncached_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } | null;
  output_tokens?: number;
}

interface AnthropicPage {
  data: Array<{ starting_at: string; ending_at: string; results: AnthropicResult[] }>;
  has_more: boolean;
  next_page: string | null;
}

export interface AnthropicOptions extends ProviderOptions {
  adminKey: string;
  baseUrl?: string;
}

export function createAnthropicIntegration(
  opts: AnthropicOptions,
): UsageIntegration & { identify(): Promise<OrgIdentity> } {
  const base = opts.baseUrl ?? ANTHROPIC_BASE_URL;
  const headers = {
    "x-api-key": opts.adminKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "User-Agent": opts.userAgent ?? "tokenrank",
  };
  const mapping = opts.categoryMap ?? {};
  const useMapping = Object.keys(mapping).length > 0;

  function categoryFor(r: AnthropicResult): Category {
    if (!useMapping) return "chat";
    return (r.api_key_id && mapping[r.api_key_id]) || (r.workspace_id && mapping[r.workspace_id]) || "chat";
  }

  return {
    source: "anthropic_api",
    async fetchUsage(since: Date, until: Date): Promise<AggregatedUsageRow[]> {
      const firstDay = localDate(since, opts.timeZone);
      const startMs = Math.floor(startOfLocalDay(firstDay, opts.timeZone) / 3_600_000) * 3_600_000;
      const acc = new UsageAccumulator();
      let page: string | null = null;
      do {
        const params = new URLSearchParams({
          starting_at: new Date(startMs).toISOString(),
          ending_at: until.toISOString(),
          bucket_width: "1h",
          limit: "168",
        });
        params.append("group_by[]", "model");
        if (useMapping) {
          params.append("group_by[]", "workspace_id");
          params.append("group_by[]", "api_key_id");
        }
        if (page) params.set("page", page);
        const { body } = await getJson<AnthropicPage>(`${base}/organizations/usage_report/messages?${params}`, headers, {
          fetch: opts.fetch,
        });
        for (const bucket of body.data ?? []) {
          const date = localDate(Date.parse(bucket.starting_at), opts.timeZone);
          if (date < firstDay) continue;
          for (const r of bucket.results ?? []) {
            acc.add({
              date,
              source: "anthropic_api",
              model: r.model ?? "unknown",
              category: categoryFor(r),
              input_tokens: r.uncached_input_tokens ?? 0,
              output_tokens: r.output_tokens ?? 0,
              cache_read_tokens: r.cache_read_input_tokens ?? 0,
              cache_write_tokens:
                (r.cache_creation?.ephemeral_5m_input_tokens ?? 0) + (r.cache_creation?.ephemeral_1h_input_tokens ?? 0),
            });
          }
        }
        opts.onProgress?.(`anthropic messages: ${body.data?.length ?? 0} buckets`);
        page = body.has_more ? body.next_page : null;
      } while (page);
      return acc.toRows().map((r) => ({ ...r, trust_level: opts.trust }));
    },
    /** GET /v1/organizations/me → { id, name, type }. Only the id is used (and hashed). */
    async identify(): Promise<OrgIdentity> {
      const { body } = await getJson<{ id?: string }>(`${base}/organizations/me`, headers, { fetch: opts.fetch });
      return { orgId: body.id ?? null };
    },
  };
}
