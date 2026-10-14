import { CATEGORIES, DEFAULT_CATEGORY_BY_SOURCE, SOURCES, USAGE_ROW_FIELDS, type Category, type Source } from "./constants";
import { UsageAccumulator } from "./aggregate";
import { parseCount, parseCsvRecords } from "./csv";
import { isDateString, localDate } from "./dates";
import type { UsageRow } from "./schemas";

export const GENERIC_CSV_COLUMNS = USAGE_ROW_FIELDS;
export const GENERIC_CSV_REQUIRED = ["date", "model"] as const;

export interface CsvImportResult {
  rows: UsageRow[];
  errors: string[];
  /** Number of input lines that contributed to `rows`. */
  lines_used: number;
}

/**
 * Generic CSV import. Columns (header names, any order):
 *   date (YYYY-MM-DD, or an ISO timestamp bucketed in `timeZone`), model,
 *   source, category, input_tokens, output_tokens, cache_read_tokens,
 *   cache_write_tokens, request_count, image_count.
 * Only `date` and `model` are required; counters default to 0, source to the
 * chosen default, category to the source default or "chat".
 * Unknown columns are an error: we refuse rather than silently ignore, so a
 * file that contains anything beyond counts is never half-imported.
 */
export function parseGenericCsv(
  text: string,
  opts: { timeZone: string; defaultSource?: Source; defaultCategory?: Category },
): CsvImportResult {
  const { headers, records } = parseCsvRecords(text);
  const errors: string[] = [];
  const normalized = headers.map((h) => h.toLowerCase());
  const unknown = normalized.filter((h) => h && !(GENERIC_CSV_COLUMNS as readonly string[]).includes(h));
  if (unknown.length) {
    errors.push(`Unknown column(s): ${unknown.join(", ")}. Allowed: ${GENERIC_CSV_COLUMNS.join(", ")}.`);
    return { rows: [], errors, lines_used: 0 };
  }
  for (const req of GENERIC_CSV_REQUIRED) {
    if (!normalized.includes(req)) errors.push(`Missing required column: ${req}`);
  }
  if (errors.length) return { rows: [], errors, lines_used: 0 };

  const acc = new UsageAccumulator();
  let used = 0;
  records.forEach((raw, idx) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => (rec[normalized[i]!] = raw[h] ?? ""));
    const line = idx + 2;
    let date = rec.date ?? "";
    if (!isDateString(date)) {
      const t = Date.parse(date);
      if (!Number.isFinite(t)) {
        errors.push(`Line ${line}: invalid date "${date.slice(0, 32)}"`);
        return;
      }
      date = localDate(t, opts.timeZone);
    }
    const rawSource: string = (rec.source || opts.defaultSource || "other").toLowerCase();
    if (!(SOURCES as readonly string[]).includes(rawSource)) {
      errors.push(`Line ${line}: unknown source "${rawSource.slice(0, 32)}"`);
      return;
    }
    const source = rawSource as Source;
    const rawCategory: string = (rec.category || opts.defaultCategory || DEFAULT_CATEGORY_BY_SOURCE[source] || "chat").toLowerCase();
    if (!(CATEGORIES as readonly string[]).includes(rawCategory)) {
      errors.push(`Line ${line}: unknown category "${rawCategory.slice(0, 32)}"`);
      return;
    }
    const category = rawCategory as Category;
    acc.add({
      date,
      source,
      category,
      model: rec.model ?? "unknown",
      input_tokens: parseCount(rec.input_tokens),
      output_tokens: parseCount(rec.output_tokens),
      cache_read_tokens: parseCount(rec.cache_read_tokens),
      cache_write_tokens: parseCount(rec.cache_write_tokens),
      request_count: parseCount(rec.request_count),
      image_count: parseCount(rec.image_count),
    });
    used++;
  });
  return { rows: acc.toRows(), errors: errors.slice(0, 50), lines_used: used };
}
