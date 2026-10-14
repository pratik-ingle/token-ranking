import { addDays, dayOfWeek, diffDays, parseDate } from "./dates";
import { formatTokens } from "./format";

export interface HeatmapCell {
  date: string;
  total_tokens: number;
  /** 0 = no activity, 1..4 = quartile of the user's own non-zero days. */
  level: 0 | 1 | 2 | 3 | 4;
  /** False for padding cells before `start` / after `end`. */
  in_range: boolean;
  /** True for dates after today (only in calendar-year mode). */
  future: boolean;
}

export interface HeatmapGrid {
  start: string;
  end: string;
  /** Columns (weeks, Sunday-first) of exactly 7 cells each. */
  weeks: HeatmapCell[][];
  /** Upper bounds of levels 1..3 (level 4 is everything above). */
  thresholds: [number, number, number];
  month_labels: { column: number; label: string }[];
  total_tokens: number;
  active_days: number;
}

export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Linear-interpolated quantile of an ascending-sorted array. */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return a + (b - a) * (pos - lo);
}

export function heatmapLevel(value: number, thresholds: readonly [number, number, number]): HeatmapCell["level"] {
  if (value <= 0) return 0;
  if (value > thresholds[2]) return 4;
  if (value > thresholds[1]) return 3;
  if (value > thresholds[0]) return 2;
  return 1;
}

/** "Mar 4, 2026" — fixed English so server and client render identically. */
export function formatHeatmapDate(date: string): string {
  const d = new Date(parseDate(date));
  return `${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function heatmapTooltip(cell: Pick<HeatmapCell, "date" | "total_tokens">): string {
  const n = cell.total_tokens;
  const amount = n === 0 ? "No" : formatTokens(n);
  return `${amount} token${n === 1 ? "" : "s"} on ${formatHeatmapDate(cell.date)}`;
}

/**
 * The window shown by the heatmap: the last 365 days ending `today`, or a
 * full calendar year (Jan 1 – Dec 31) when `year` is given.
 */
export function heatmapRange(today: string, year?: number | null): { start: string; end: string } {
  if (year) return { start: `${year}-01-01`, end: `${year}-12-31` };
  return { start: addDays(today, -364), end: today };
}

/**
 * Lays out daily totals as a GitHub-style grid: one column per week
 * (Sunday→Saturday), padded at both ends. The rolling 365-day view always
 * fits in 53 columns; a leap year starting on Saturday needs 54.
 * Levels use quartiles of the user's own non-zero days in the range, so a
 * light user and a heavy user both get a full colour range.
 */
export function buildHeatmap(params: {
  days: ReadonlyArray<{ date: string; total_tokens: number }>;
  today: string;
  year?: number | null;
}): HeatmapGrid {
  const { start, end } = heatmapRange(params.today, params.year);
  const totals = new Map<string, number>();
  for (const d of params.days) {
    if (d.date < start || d.date > end) continue;
    totals.set(d.date, (totals.get(d.date) ?? 0) + d.total_tokens);
  }

  const nonZero = [...totals.values()].filter((v) => v > 0).sort((a, b) => a - b);
  const thresholds: [number, number, number] = [
    quantile(nonZero, 0.25),
    quantile(nonZero, 0.5),
    quantile(nonZero, 0.75),
  ];

  const gridStart = addDays(start, -dayOfWeek(start));
  const gridEnd = addDays(end, 6 - dayOfWeek(end));
  const columns = (diffDays(gridStart, gridEnd) + 1) / 7;
  const weeks: HeatmapCell[][] = [];
  const monthLabels: { column: number; label: string }[] = [];
  let total = 0;
  let active = 0;

  for (let c = 0; c < columns; c++) {
    const week: HeatmapCell[] = [];
    for (let r = 0; r < 7; r++) {
      const date = addDays(gridStart, c * 7 + r);
      const inRange = date >= start && date <= end;
      const value = inRange ? (totals.get(date) ?? 0) : 0;
      if (inRange) {
        total += value;
        if (value > 0) active++;
        if (date.endsWith("-01") || (c === 0 && date === start && Number(date.slice(8)) <= 7)) {
          const label = MONTH_SHORT[Number(date.slice(5, 7)) - 1]!;
          if (!monthLabels.some((m) => m.column === c)) monthLabels.push({ column: c, label });
        }
      }
      week.push({
        date,
        total_tokens: value,
        level: inRange ? heatmapLevel(value, thresholds) : 0,
        in_range: inRange,
        future: inRange && date > params.today,
      });
    }
    weeks.push(week);
  }

  return { start, end, weeks, thresholds, month_labels: monthLabels, total_tokens: total, active_days: active };
}
