import { formatPercentile } from "./format";

/**
 * Standard competition ranking ("1224"), identical to SQL RANK():
 * equal scores share a rank and the next distinct score skips ahead.
 * Ties are ordered by `tieBreak` for display only; it never changes the rank.
 */
export function assignRanks<T>(
  items: readonly T[],
  score: (item: T) => number,
  tieBreak: (a: T, b: T) => number = () => 0,
): Array<T & { rank: number }> {
  const sorted = [...items].sort((a, b) => score(b) - score(a) || tieBreak(a, b));
  let rank = 0;
  let prevScore: number | null = null;
  return sorted.map((item, i) => {
    const s = score(item);
    if (prevScore === null || s !== prevScore) rank = i + 1;
    prevScore = s;
    return { ...item, rank };
  });
}

/**
 * Rank a score would have among `others` (used for hidden users, who are not
 * in the public ranking but may see where they would stand).
 * Returns 1 + number of strictly greater scores, and the population size
 * including the user.
 */
export function hypotheticalRank(myScore: number, others: readonly number[]): { rank: number; total: number } {
  let greater = 0;
  for (const s of others) if (s > myScore) greater++;
  return { rank: greater + 1, total: others.length + 1 };
}

export function percentileLabel(rank: number | null, total: number): string | null {
  if (rank === null || total <= 0) return null;
  return formatPercentile(rank, total);
}

/** Which page (1-based) a rank lands on. */
export function pageForRank(rank: number, pageSize: number): number {
  return Math.max(1, Math.ceil(rank / pageSize));
}
