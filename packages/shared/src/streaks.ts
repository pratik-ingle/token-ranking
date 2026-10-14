import { addDays, diffDays } from "./dates";

export interface StreakInput {
  /** Local dates (YYYY-MM-DD, user's timezone) with their token totals. */
  days: ReadonlyArray<{ date: string; total_tokens: number }>;
  /** Today's date in the user's timezone. */
  today: string;
  /** A day is active when total_tokens >= this (default 1). */
  minTokens?: number;
}

export interface StreakResult {
  current: number;
  longest: number;
  active_days: number;
  /** Most recent active date, if any. */
  last_active: string | null;
}

/**
 * Streaks over local calendar dates.
 *
 * - Active day: total tokens >= minTokens.
 * - Current streak: consecutive active days ending today OR yesterday. We
 *   allow yesterday so a streak is not "broken" in the morning before the
 *   user's first sync of the day.
 * - Longest streak: longest run of consecutive active days ever.
 *
 * Dates after `today` (e.g. a client clock ahead of the server) are ignored.
 * All inputs are already local dates, so DST cannot affect the result: the
 * timezone only matters when instants are bucketed into dates.
 */
export function computeStreaks({ days, today, minTokens = 1 }: StreakInput): StreakResult {
  const active = new Set<string>();
  for (const d of days) {
    if (d.total_tokens >= minTokens && d.date <= today) active.add(d.date);
  }
  const sorted = [...active].sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const date of sorted) {
    run = prev !== null && diffDays(prev, date) === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = date;
  }

  let current = 0;
  const last = sorted.at(-1) ?? null;
  if (last !== null && (last === today || last === addDays(today, -1))) {
    let cursor = last;
    while (active.has(cursor)) {
      current++;
      cursor = addDays(cursor, -1);
    }
  }
  return { current, longest, active_days: sorted.length, last_active: last };
}
