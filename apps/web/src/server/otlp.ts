import { localDate, normalizeModel, UsageAccumulator, type UsageRow } from "@tokenrank/shared";

/**
 * Claude Code OpenTelemetry metrics → daily usage rows.
 * We read ONLY metric `claude_code.token.usage`, its data point value, time,
 * and the `type` and `model` attributes. Every other metric, resource
 * attribute and data point attribute (user.email, user.account_uuid,
 * organization.id, session.id, …) is ignored and never stored.
 * Only DELTA temporality is accepted (Claude Code's default); cumulative
 * points would need per-session state we refuse to keep.
 */
export const TOKEN_METRIC = "claude_code.token.usage";
const DELTA = 1;

type AnyValue = { stringValue?: string; intValue?: string | number; doubleValue?: number };
interface Attribute {
  key?: string;
  value?: AnyValue;
}
interface DataPoint {
  attributes?: Attribute[];
  timeUnixNano?: string | number;
  asInt?: string | number;
  asDouble?: number;
}
interface Metric {
  name?: string;
  sum?: { aggregationTemporality?: number; dataPoints?: DataPoint[] };
}
export interface OtlpMetricsRequest {
  resourceMetrics?: Array<{ scopeMetrics?: Array<{ metrics?: Metric[] }> }>;
}

export interface OtlpParseResult {
  rows: UsageRow[];
  accepted: number;
  rejected: number;
  reason: string | null;
}

function attr(point: DataPoint, key: string): string | null {
  const a = point.attributes?.find((x) => x.key === key);
  return a?.value?.stringValue ?? null;
}

export function parseOtlpMetrics(body: OtlpMetricsRequest, timeZone: string): OtlpParseResult {
  const acc = new UsageAccumulator();
  let accepted = 0;
  let rejected = 0;
  let reason: string | null = null;
  for (const rm of body.resourceMetrics ?? []) {
    for (const sm of rm.scopeMetrics ?? []) {
      for (const metric of sm.metrics ?? []) {
        if (metric.name !== TOKEN_METRIC || !metric.sum) continue;
        if (metric.sum.aggregationTemporality !== DELTA) {
          const n = metric.sum.dataPoints?.length ?? 0;
          rejected += n;
          if (n) reason = "Only delta temporality is supported (unset OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE).";
          continue;
        }
        for (const p of metric.sum.dataPoints ?? []) {
          const value = Number(p.asInt ?? p.asDouble ?? 0);
          const nanos = Number(p.timeUnixNano ?? 0);
          const type = attr(p, "type");
          if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(nanos) || nanos <= 0 || !type) {
            rejected++;
            continue;
          }
          const date = localDate(Math.floor(nanos / 1e6), timeZone);
          const model = normalizeModel(attr(p, "model"));
          const delta = { date, source: "claude_code" as const, model, category: "coding" as const };
          switch (type) {
            case "input":
              acc.add({ ...delta, input_tokens: value });
              break;
            case "output":
              acc.add({ ...delta, output_tokens: value });
              break;
            case "cacheRead":
              acc.add({ ...delta, cache_read_tokens: value });
              break;
            case "cacheCreation":
              acc.add({ ...delta, cache_write_tokens: value });
              break;
            default:
              rejected++;
              continue;
          }
          accepted++;
        }
      }
    }
  }
  return { rows: acc.toRows(), accepted, rejected, reason };
}
