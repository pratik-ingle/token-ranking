const UNITS = [
  { value: 1e12, suffix: "T" },
  { value: 1e9, suffix: "B" },
  { value: 1e6, suffix: "M" },
  { value: 1e3, suffix: "K" },
] as const;

function trimZero(s: string): string {
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/**
 * Compact token counts: 999 → "999", 12_345 → "12.3K", 1_200_000 → "1.2M",
 * 3_400_000_000 → "3.4B". One decimal below 100 of a unit, none above.
 */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs < 1000) return sign + String(Math.round(abs));
  for (let i = UNITS.length - 1; i >= 0; i--) {
    const unit = UNITS[i]!;
    const next = UNITS[i - 1];
    if (next && abs >= next.value) continue;
    const scaled = abs / unit.value;
    const text = scaled < 99.95 ? trimZero(scaled.toFixed(1)) : String(Math.round(scaled));
    // Rounding can carry into the next unit (999_950 → "1000K"); use it instead.
    if (Number(text) >= 1000 && next) return sign + trimZero((abs / next.value).toFixed(1)) + next.suffix;
    return sign + text + unit.suffix;
  }
  return sign + String(abs);
}

/** 1234567 → "1,234,567" (fixed locale so SSR and the browser agree). */
export function formatInteger(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/**
 * Percent of ranked users at or above this rank, as a "Top X%" label.
 * Ties share a rank, so tied users get the same label.
 */
export function topPercent(rank: number, total: number): number {
  if (total <= 0 || rank <= 0) return 100;
  return Math.min(100, (rank / total) * 100);
}

export function formatPercentile(rank: number, total: number): string {
  const p = topPercent(rank, total);
  if (p < 1) {
    // One decimal, rounded up so we never overstate (0.21% → "Top 0.3%").
    const tenths = Math.max(0.1, Math.ceil(p * 10 - 1e-9) / 10);
    return `Top ${tenths.toFixed(1)}%`;
  }
  return `Top ${Math.ceil(p - 1e-9)}%`;
}

export function formatRank(rank: number): string {
  return `#${formatInteger(rank)}`;
}
