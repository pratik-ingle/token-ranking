import {
  CATEGORY_LABELS,
  SOURCE_LABELS,
  WINDOW_LABELS,
  formatInteger,
  formatTokens,
  type BreakdownItem,
  type Category,
  type LeaderboardWindow,
  type MeRankResponse,
  type Source,
  type UserStatsResponse,
} from "@tokenrank/shared";
import type { SyncSummary } from "tokenrank-collector";

const windowLabel = (w: string) => WINDOW_LABELS[w as LeaderboardWindow] ?? w;

export function rankText(rank: MeRankResponse): string {
  const lines = [
    `TokenRank for @${rank.username} (${rank.include_cache ? "cache tokens included" : "cache tokens excluded"})${
      rank.visibility === "hidden" ? " — profile hidden, not listed publicly" : ""
    }`,
  ];
  for (const w of rank.windows) {
    const pos =
      w.rank === null
        ? "not ranked yet"
        : `#${formatInteger(w.rank)} of ${formatInteger(w.ranked_users)}${w.percentile_label ? ` (${w.percentile_label})` : ""}`;
    lines.push(`- ${windowLabel(w.window)}: ${pos}, ${formatTokens(w.total_tokens)} tokens`);
  }
  lines.push(`Profile: ${rank.profile_url}`);
  return lines.join("\n");
}

function top(items: BreakdownItem[], n: number, label: (key: string, fallback: string) => string): string {
  if (items.length === 0) return "none yet";
  return items
    .slice(0, n)
    .map((i) => `${label(i.key, i.label)} ${formatTokens(i.total_tokens)}`)
    .join(", ");
}

export function statsText(s: UserStatsResponse): string {
  const t = s.totals;
  const total = t.input_tokens + t.output_tokens + t.cache_read_tokens + t.cache_write_tokens;
  return [
    `@${s.username} — joined ${s.joined.slice(0, 10)}, days in ${s.timezone}`,
    `Total: ${formatTokens(t.total_tokens ?? total)} tokens (input ${formatTokens(t.input_tokens)}, output ${formatTokens(t.output_tokens)}, cache read ${formatTokens(
      t.cache_read_tokens,
    )}, cache write ${formatTokens(t.cache_write_tokens)}), ${formatInteger(t.request_count)} requests${t.image_count ? `, ${formatInteger(t.image_count)} images` : ""}`,
    `Streaks: current ${s.streaks.current} days, longest ${s.streaks.longest} days, ${s.streaks.active_days} active days`,
    `Top sources: ${top(s.by_source, 5, (k, l) => SOURCE_LABELS[k as Source] ?? l)}`,
    `Top categories: ${top(s.by_category, 3, (k, l) => CATEGORY_LABELS[k as Category] ?? l)}`,
    `Top models: ${top(s.top_models, 5, (_k, l) => l)}`,
    ...s.windows.map(
      (w) => `- ${windowLabel(w.window)}: ${formatTokens(w.total_tokens)} tokens${w.rank !== null ? `, rank #${formatInteger(w.rank)} of ${formatInteger(w.ranked_users)}` : ""}`,
    ),
    `Verified share: ${Math.round(s.verified_share * 100)}%${s.flagged_days ? ` · ${s.flagged_days} day(s) flagged for review` : ""}`,
  ].join("\n");
}

/** Counts only: no row-level data. */
export function syncStructured(summary: SyncSummary) {
  return {
    dry_run: summary.dryRun,
    ok: summary.ok,
    time_zone: summary.timeZone,
    sources: summary.sources.map((s) => ({
      source: s.source,
      status: s.status,
      ...(s.error ? { error: s.error } : {}),
      affected_from: s.affectedFrom,
      days: s.days,
      rows: s.rows,
      total_tokens: s.totalTokens,
      requests: s.requests,
      uploaded: s.uploaded,
      ...(s.heartbeat === "duplicate" ? { org_claimed_by_another_account: true } : {}),
    })),
    totals: {
      days: summary.totals.days,
      rows: summary.totals.rows,
      total_tokens: summary.totals.totalTokens,
      requests: summary.totals.requests,
    },
  };
}

export function syncText(summary: SyncSummary): string {
  const head = summary.dryRun
    ? `Dry run — nothing was uploaded. Days bucketed in ${summary.timeZone}.`
    : `${summary.ok ? "Sync complete" : "Sync finished with errors"}. Days bucketed in ${summary.timeZone}.`;
  if (summary.sources.length === 0) return `${head}\nNo sources are enabled. Run \`npx tokenrank-collector sources\` in a terminal.`;
  const lines = summary.sources.map((s) => {
    if (s.status === "error") return `- ${s.label}: error — ${s.error}`;
    const state = summary.dryRun ? "would upload" : s.uploaded ? "uploaded" : "not uploaded";
    const claimed = s.heartbeat === "duplicate" ? " (this provider org is linked to another account; it won't count on the leaderboard)" : "";
    return `- ${s.label}: ${s.days} days, ${s.rows} rows, ${formatTokens(s.totalTokens)} tokens, ${formatInteger(s.requests)} requests — ${state}${claimed}`;
  });
  return [head, ...lines].join("\n");
}
