import { WINDOW_LABELS, formatInteger, formatTokens, type LeaderboardWindow, type MeRankResponse } from "@tokenrank/shared";
import type { SyncSummary } from "./sync";

/**
 * Plain-text table. `numeric` marks right-aligned columns; by default every
 * column but the first is treated as numeric.
 */
export function table(headers: string[], rows: string[][], numeric?: boolean[]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const right = numeric ?? headers.map((_, i) => i > 0);
  const fmt = (cells: string[]) =>
    cells
      .map((c, i) => (right[i] ? c.padStart(widths[i]!) : c.padEnd(widths[i]!)))
      .join("  ")
      .trimEnd();
  return [fmt(headers), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(fmt)].join("\n");
}

export function formatSyncSummary(summary: SyncSummary): string {
  const rows = summary.sources.map((s) => [
    s.label,
    s.status === "ok" ? String(s.days) : "-",
    s.status === "ok" ? String(s.rows) : "-",
    s.status === "ok" ? formatTokens(s.totalTokens) : "-",
    s.status === "ok" ? formatInteger(s.requests) : "-",
    s.status === "error"
      ? "error"
      : summary.dryRun
        ? "dry run"
        : s.uploaded
          ? s.heartbeat === "duplicate"
            ? "uploaded (org claimed elsewhere)"
            : "uploaded"
          : "-",
  ]);
  if (summary.sources.length > 1) {
    rows.push([
      "Total",
      String(summary.totals.days),
      String(summary.totals.rows),
      formatTokens(summary.totals.totalTokens),
      formatInteger(summary.totals.requests),
      "",
    ]);
  }
  const lines = [table(["Source", "Days", "Rows", "Tokens", "Requests", "Status"], rows, [false, true, true, true, true, false])];
  for (const s of summary.sources) {
    if (s.error) lines.push(`  ${s.label}: ${s.error}`);
  }
  lines.push(`Days are bucketed in ${summary.timeZone}.`);
  return lines.join("\n");
}

function windowLabel(w: string): string {
  return WINDOW_LABELS[w as LeaderboardWindow] ?? w;
}

export function formatRank(rank: MeRankResponse): string {
  const lines = [`@${rank.username}${rank.visibility === "hidden" ? " (profile hidden; not listed publicly)" : ""}`];
  for (const w of rank.windows) {
    const pos =
      w.rank === null
        ? "not ranked"
        : `#${formatInteger(w.rank)} of ${formatInteger(w.ranked_users)}${w.percentile_label ? ` (${w.percentile_label})` : ""}`;
    lines.push(`  ${windowLabel(w.window).padEnd(10)} ${pos.padEnd(28)} ${formatTokens(w.total_tokens)} tokens`);
  }
  lines.push(`Profile: ${rank.profile_url}`);
  return lines.join("\n");
}
