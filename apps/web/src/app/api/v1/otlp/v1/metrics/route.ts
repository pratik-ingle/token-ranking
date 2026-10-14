import { chunkRows, MAX_ROWS_PER_REQUEST } from "@tokenrank/shared";
import { getDb } from "@/db/client";
import { requireToken } from "@/server/auth";
import { api, ApiError, enforceRateLimit, json, readJson } from "@/server/http";
import { ingestRows } from "@/server/ingest";
import { parseOtlpMetrics, type OtlpMetricsRequest } from "@/server/otlp";
import { LIMITS } from "@/server/rate-limit";

/**
 * OTLP/HTTP JSON metrics receiver for Claude Code telemetry:
 *   CLAUDE_CODE_ENABLE_TELEMETRY=1
 *   OTEL_METRICS_EXPORTER=otlp
 *   OTEL_EXPORTER_OTLP_PROTOCOL=http/json
 *   OTEL_EXPORTER_OTLP_ENDPOINT=https://<host>/api/v1/otlp
 *   OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer tr_..."
 * Only claude_code.token.usage (type, model, value, time) is read. Deltas
 * are added to the day's totals. Use this OR the collector's Claude Code
 * parser, not both (a collector sync replaces the day's values).
 */
export const POST = api("POST /api/v1/otlp/v1/metrics", async (req) => {
  const user = await requireToken(req, "ingest");
  enforceRateLimit(`otlp-token:${user.tokenId}`, LIMITS.otlpPerToken);
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("json")) {
    throw new ApiError(415, "unsupported_media_type", "Only OTLP/HTTP JSON is supported. Set OTEL_EXPORTER_OTLP_PROTOCOL=http/json.");
  }
  const body = (await readJson(req, 4_000_000)) as OtlpMetricsRequest;
  const parsed = parseOtlpMetrics(body, user.timezone);
  for (const chunk of chunkRows(parsed.rows, MAX_ROWS_PER_REQUEST)) {
    await ingestRows(getDb(), chunk, { userId: user.id, timeZone: user.timezone, trust: "self_reported", mode: "local", semantics: "increment" });
  }
  // OTLP ExportMetricsServiceResponse, with partial success when we dropped points.
  return json(
    parsed.rejected > 0
      ? { partialSuccess: { rejectedDataPoints: String(parsed.rejected), errorMessage: parsed.reason ?? "Some data points were ignored." } }
      : {},
  );
});
