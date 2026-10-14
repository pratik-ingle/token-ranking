import { UsageAccumulator } from "./aggregate";
import { parseCount, parseCsvRecords } from "./csv";
import { isDateString, localDate } from "./dates";
import type { UsageRow } from "./schemas";

/**
 * Cursor dashboard usage export (cursor.com/dashboard → Usage → Export CSV).
 * There is no official spec; header variants seen in real exports:
 *   v3: Date,[User,]Cloud Agent ID,Automation ID,Kind,Model,Max Mode,
 *       Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost
 *   v2: Date,[User,]Kind,Model,Max Mode,Input (w/ Cache Write),…,Total Tokens,Cost|Requests
 *   v1: Date,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost,Cost to you
 * Columns are matched by name. Only Date, Model and the four token columns are
 * read; cost, kind, agent ids and the team "User" (email) column are ignored —
 * except that for team exports the user picks their own row filter locally.
 * "Input (w/ Cache Write)" holds cache-write tokens; "Input (w/o Cache Write)"
 * holds plain input. Each CSV line is one request.
 */
export const CURSOR_CSV_COLUMNS = {
  date: "Date",
  model: "Model",
  cacheWrite: "Input (w/ Cache Write)",
  input: "Input (w/o Cache Write)",
  cacheRead: "Cache Read",
  output: "Output Tokens",
  user: "User",
} as const;

export interface CursorCsvResult {
  rows: UsageRow[];
  errors: string[];
  lines_used: number;
  /** Present for team exports: distinct values of the User column, for a local picker. */
  users: string[] | null;
}

export function isCursorCsv(headers: readonly string[]): boolean {
  const set = new Set(headers.map((h) => h.trim()));
  return [CURSOR_CSV_COLUMNS.date, CURSOR_CSV_COLUMNS.model, CURSOR_CSV_COLUMNS.output].every((h) => set.has(h));
}

export function parseCursorCsv(text: string, opts: { timeZone: string; user?: string | null }): CursorCsvResult {
  const { headers, records } = parseCsvRecords(text);
  const errors: string[] = [];
  if (!isCursorCsv(headers)) {
    return {
      rows: [],
      errors: ["This doesn't look like a Cursor usage export (expected Date, Model and Output Tokens columns)."],
      lines_used: 0,
      users: null,
    };
  }
  const hasUser = headers.includes(CURSOR_CSV_COLUMNS.user);
  const users = hasUser ? [...new Set(records.map((r) => r[CURSOR_CSV_COLUMNS.user] ?? "").filter(Boolean))].sort() : null;
  if (hasUser && users && users.length > 1 && !opts.user) {
    return {
      rows: [],
      errors: ["This is a team export with several members. Choose which member is you; other members' rows are ignored."],
      lines_used: 0,
      users,
    };
  }

  const acc = new UsageAccumulator();
  let used = 0;
  records.forEach((rec, idx) => {
    if (hasUser && opts.user && rec[CURSOR_CSV_COLUMNS.user] !== opts.user) return;
    const raw = rec[CURSOR_CSV_COLUMNS.date] ?? "";
    let date: string;
    if (isDateString(raw)) {
      date = raw;
    } else {
      // Exports use ISO UTC ("2026-07-05T13:18:24.614Z"); tolerate a missing "Z".
      const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}Z`);
      if (!Number.isFinite(t)) {
        errors.push(`Line ${idx + 2}: invalid date`);
        return;
      }
      date = localDate(t, opts.timeZone);
    }
    acc.add({
      date,
      source: "cursor",
      category: "coding",
      model: rec[CURSOR_CSV_COLUMNS.model] || "unknown",
      input_tokens: parseCount(rec[CURSOR_CSV_COLUMNS.input]),
      cache_write_tokens: parseCount(rec[CURSOR_CSV_COLUMNS.cacheWrite]),
      cache_read_tokens: parseCount(rec[CURSOR_CSV_COLUMNS.cacheRead]),
      output_tokens: parseCount(rec[CURSOR_CSV_COLUMNS.output]),
      request_count: 1,
    });
    used++;
  });
  return { rows: acc.toRows(), errors: errors.slice(0, 50), lines_used: used, users };
}
