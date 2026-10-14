import type { Category } from "../constants";
import { UsageAccumulator } from "../aggregate";
import { localDate, startOfLocalDay } from "../dates";
import type { AggregatedUsageRow } from "../schemas";
import { getJson } from "./http";
import type { OrgIdentity, ProviderOptions, UsageIntegration } from "./types";

/**
 * OpenAI Organization Usage API (Admin key required).
 * Verified 2026-10-14 against the OpenAI OpenAPI spec v2.3.0:
 *   GET /v1/organization/usage/{completions,embeddings,images,audio_speeches,audio_transcriptions}
 *   start_time (unix s, inclusive), end_time (exclusive), bucket_width 1m|1h|1d,
 *   limit (1h: max 168), group_by repeated, page = next_page.
 * input_tokens INCLUDES cached and cache-write tokens, so we subtract them to
 * keep our four token fields disjoint.
 */
export const OPENAI_BASE_URL = "https://api.openai.com/v1";

export const OPENAI_ENDPOINTS: ReadonlyArray<{ path: string; category: Category; tokens: boolean }> = [
  { path: "completions", category: "chat", tokens: true },
  { path: "embeddings", category: "embeddings", tokens: true },
  { path: "images", category: "image_generation", tokens: false },
  { path: "audio_speeches", category: "audio", tokens: false },
  { path: "audio_transcriptions", category: "audio", tokens: false },
];

interface OpenAIResult {
  object?: string;
  model?: string | null;
  project_id?: string | null;
  api_key_id?: string | null;
  input_tokens?: number;
  output_tokens?: number;
  input_cached_tokens?: number;
  input_cache_write_tokens?: number;
  input_cache_write_12h_tokens?: number;
  num_model_requests?: number;
  images?: number;
}

interface OpenAIPage {
  data: Array<{ start_time: number; end_time: number; results: OpenAIResult[] }>;
  has_more: boolean;
  next_page: string | null;
}

export interface OpenAIOptions extends ProviderOptions {
  adminKey: string;
  baseUrl?: string;
}

export function createOpenAIIntegration(opts: OpenAIOptions): UsageIntegration & { identify(): Promise<OrgIdentity> } {
  const base = opts.baseUrl ?? OPENAI_BASE_URL;
  const headers = {
    Authorization: `Bearer ${opts.adminKey}`,
    "Content-Type": "application/json",
    "User-Agent": opts.userAgent ?? "tokenrank",
  };
  const mapping = opts.categoryMap ?? {};
  const useMapping = Object.keys(mapping).length > 0;
  let orgFromHeader: string | null = null;

  function categoryFor(endpointCategory: Category, r: OpenAIResult): Category {
    if (endpointCategory !== "chat" || !useMapping) return endpointCategory;
    return (r.api_key_id && mapping[r.api_key_id]) || (r.project_id && mapping[r.project_id]) || "chat";
  }

  async function fetchEndpoint(
    endpoint: (typeof OPENAI_ENDPOINTS)[number],
    startSec: number,
    endSec: number,
    firstDay: string,
    acc: UsageAccumulator,
  ): Promise<void> {
    let page: string | null = null;
    do {
      const params = new URLSearchParams({
        start_time: String(startSec),
        end_time: String(endSec),
        bucket_width: "1h",
        limit: "168",
      });
      params.append("group_by", "model");
      if (useMapping && endpoint.category === "chat") {
        // Only needed to apply the local category map; ids never leave this function.
        params.append("group_by", "project_id");
        params.append("group_by", "api_key_id");
      }
      if (page) params.set("page", page);
      const { body, headers: resHeaders } = await getJson<OpenAIPage>(
        `${base}/organization/usage/${endpoint.path}?${params}`,
        headers,
        { fetch: opts.fetch },
      );
      orgFromHeader ??= resHeaders.get("openai-organization");
      for (const bucket of body.data ?? []) {
        const date = localDate(bucket.start_time * 1000, opts.timeZone);
        if (date < firstDay) continue;
        for (const r of bucket.results ?? []) {
          const requests = r.num_model_requests ?? 0;
          if (!endpoint.tokens) {
            acc.add({
              date,
              source: "openai_api",
              model: r.model ?? endpoint.path,
              category: endpoint.category,
              request_count: requests,
              image_count: endpoint.path === "images" ? (r.images ?? 0) : 0,
            });
            continue;
          }
          const cacheRead = r.input_cached_tokens ?? 0;
          const cacheWrite = (r.input_cache_write_tokens ?? 0) + (r.input_cache_write_12h_tokens ?? 0);
          acc.add({
            date,
            source: "openai_api",
            model: r.model ?? "unknown",
            category: categoryFor(endpoint.category, r),
            input_tokens: Math.max(0, (r.input_tokens ?? 0) - cacheRead - cacheWrite),
            output_tokens: r.output_tokens ?? 0,
            cache_read_tokens: cacheRead,
            cache_write_tokens: cacheWrite,
            request_count: requests,
          });
        }
      }
      opts.onProgress?.(`openai ${endpoint.path}: ${body.data?.length ?? 0} buckets`);
      page = body.has_more ? body.next_page : null;
    } while (page);
  }

  return {
    source: "openai_api",
    async fetchUsage(since: Date, until: Date): Promise<AggregatedUsageRow[]> {
      const firstDay = localDate(since, opts.timeZone);
      const startMs = startOfLocalDay(firstDay, opts.timeZone);
      // Hour buckets are UTC-aligned: floor to the hour; buckets are assigned
      // to the local date of their start time.
      const startSec = Math.floor(startMs / 3_600_000) * 3600;
      const endSec = Math.ceil(until.getTime() / 1000);
      const acc = new UsageAccumulator();
      for (const endpoint of OPENAI_ENDPOINTS) {
        await fetchEndpoint(endpoint, startSec, endSec, firstDay, acc);
      }
      return acc.toRows().map((r) => ({ ...r, trust_level: opts.trust }));
    },
    /**
     * OpenAI has no "who am I" endpoint for admin keys; the docs list an
     * `openai-organization` response header, which we read when present.
     */
    async identify(): Promise<OrgIdentity> {
      if (!orgFromHeader) {
        const now = Math.floor(Date.now() / 1000);
        const { headers: h } = await getJson<OpenAIPage>(
          `${base}/organization/usage/completions?start_time=${now - 3600}&bucket_width=1h&limit=1`,
          headers,
          { fetch: opts.fetch },
        );
        orgFromHeader = h.get("openai-organization");
      }
      return { orgId: orgFromHeader };
    },
  };
}
