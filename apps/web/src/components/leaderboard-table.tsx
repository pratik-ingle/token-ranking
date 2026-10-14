import { formatInteger, formatTokens, SOURCE_LABELS, type Category, type CategoryShare, type LeaderboardEntry, type Source } from "@tokenrank/shared";
import { BadgeCheck } from "lucide-react";
import Link from "next/link";
import { CATEGORY_SHORT } from "@/lib/categories";
import { cn } from "@/lib/utils";
import { categoryColor, categoryIndex } from "./charts/series";
import { Identicon } from "./identicon";

export type TableRow = { kind: "entry"; entry: LeaderboardEntry } | { kind: "gap"; count: number };

function pct(share: number): string {
  if (share > 0 && share < 0.005) return "<1%";
  return `${Math.round(share * 100)}%`;
}

/** "Coding 72%, Chat 10%, …" in the bar's fixed category order. */
export function mixLabel(mix: readonly CategoryShare[]): string {
  if (!mix.length) return "No category data";
  return [...mix]
    .sort((a, b) => categoryIndex(a.key) - categoryIndex(b.key))
    .map((c) => `${CATEGORY_SHORT[c.key]} ${pct(c.share)}`)
    .join(", ");
}

/** 120×8 stacked bar of category shares, fixed order, 2px gaps; other segments dim when a category is selected. */
export function MixBar({ mix, selected }: { mix: readonly CategoryShare[]; selected: Category | "all" }) {
  const label = mixLabel(mix);
  const ordered = [...mix].sort((a, b) => categoryIndex(a.key) - categoryIndex(b.key));
  return (
    <span role="img" aria-label={label} title={label} className="flex h-2 w-[120px] gap-[2px] overflow-hidden rounded-full bg-muted">
      {ordered.map((c) => (
        <span
          key={c.key}
          className="h-full min-w-[2px]"
          style={{
            width: `${c.share * 100}%`,
            background: categoryColor(c.key),
            opacity: selected !== "all" && selected !== c.key ? 0.35 : 1,
          }}
        />
      ))}
    </span>
  );
}

export function VerifiedIcon({ share, inverted }: { share: number; inverted?: boolean }) {
  if (share <= 0) return null;
  const full = share >= 0.999;
  const title = full ? "All tokens in this view were pulled by TokenRank from a provider API" : `${Math.round(share * 100)}% verified`;
  return (
    <span title={title} className={cn("inline-flex shrink-0", full ? (inverted ? "text-background" : "text-focus") : inverted ? "text-background/60" : "text-muted-foreground")}>
      <BadgeCheck className="size-4" aria-hidden />
      <span className="sr-only">{title}</span>
    </span>
  );
}

function appsLabel(sources: readonly Source[]): { first: string; more: number; title: string } {
  const names = sources.map((s) => SOURCE_LABELS[s] ?? s);
  return { first: names[0] ?? "—", more: Math.max(0, names.length - 1), title: names.join(", ") };
}

function streakText(days: number): string {
  return days === 1 ? "1 day" : `${formatInteger(days)} days`;
}

interface TableProps {
  rows: TableRow[];
  /** Your username, to highlight (invert) your row. */
  me?: string | null;
  /** The #1 total under the current filter; token bars are value ÷ this. */
  topTotal: number;
  category?: Category | "all";
  /** Home-page variant: rank, username and tokens only. */
  compact?: boolean;
  caption: string;
  /** Pinned to the bottom of the viewport while the table is on screen (you, when not in the visible rows). */
  stickyMe?: { entry: LeaderboardEntry; note: string } | null;
}

/*
 * The wrapper uses overflow: clip (not hidden/auto) for the rounded corners, so
 * it is not a scroll container and the sticky <tfoot> sticks to the viewport.
 * table-fixed keeps the table within its width, so it never needs to scroll.
 */
export function LeaderboardTable({ rows, me, topTotal, category = "all", compact = false, caption, stickyMe }: TableProps) {
  return (
    <div className="overflow-clip rounded-xl border bg-card">
      <table className="w-full table-fixed text-sm">
        <caption className="sr-only">{caption}</caption>
        <TableHead compact={compact} />
        <tbody>
          {rows.map((r) =>
            r.kind === "gap" ? (
              <tr key="gap" className="border-b last:border-0">
                {/* Separate cells per breakpoint: a colSpan covering hidden columns would reserve their width. */}
                <td colSpan={compact ? 3 : 4} className={cn("px-4 py-3 text-center text-sm text-muted-foreground", !compact && "min-[640px]:hidden")}>
                  {formatInteger(r.count)} {r.count === 1 ? "person" : "people"} in between
                </td>
                {!compact && (
                  <td colSpan={6} className="hidden px-4 py-3 text-center text-sm text-muted-foreground min-[640px]:table-cell">
                    {formatInteger(r.count)} {r.count === 1 ? "person" : "people"} in between
                  </td>
                )}
              </tr>
            ) : (
              <EntryRow key={r.entry.username} e={r.entry} me={r.entry.username === me} topTotal={topTotal} category={category} compact={compact} />
            ),
          )}
          {rows.length === 0 && (
            <tr>
              <td colSpan={compact ? 3 : 4} className="px-4 py-10 text-center text-muted-foreground">Nobody here yet for this filter.</td>
            </tr>
          )}
        </tbody>
        {stickyMe && (
          <tfoot className="sticky bottom-0 z-10 border-t-2 border-background">
            <EntryRow e={stickyMe.entry} me topTotal={topTotal} category={category} compact={compact} note={stickyMe.note} sticky />
          </tfoot>
        )}
      </table>
    </div>
  );
}

function TableHead({ compact }: { compact: boolean }) {
  const th = "px-2 py-2.5 font-medium first:pl-3 sm:px-4";
  return (
    <thead className="border-b text-left text-xs text-muted-foreground">
      <tr>
        <th scope="col" className={cn(th, "w-12 sm:w-16")}>Rank</th>
        <th scope="col" className={th}>Username</th>
        <th scope="col" className={cn(th, "w-[5.5rem] text-right sm:w-32")}>Tokens</th>
        {!compact && <th scope="col" className={cn(th, "hidden w-[152px] min-[640px]:table-cell")}>Mix</th>}
        {!compact && <th scope="col" className={cn(th, "w-[4.75rem] sm:w-24")}>Streak</th>}
        {!compact && <th scope="col" className={cn(th, "hidden w-40 min-[640px]:table-cell")}>Apps</th>}
      </tr>
    </thead>
  );
}

function EntryRow({
  e,
  me,
  topTotal,
  category,
  compact,
  note,
  sticky,
}: {
  e: LeaderboardEntry;
  me: boolean;
  topTotal: number;
  category: Category | "all";
  compact: boolean;
  note?: string;
  sticky?: boolean;
}) {
  const td = "px-2 py-2.5 align-middle first:pl-3 sm:px-4";
  const top3 = e.rank <= 3;
  const apps = appsLabel(e.sources);
  const barWidth = topTotal > 0 ? Math.max(0.6, Math.min(100, (e.total_tokens / topTotal) * 100)) : 0;
  return (
    <tr
      id={me && !sticky ? "me" : undefined}
      aria-label={sticky ? `Your position: ${note ?? ""}` : undefined}
      className={cn("border-b last:border-0", me ? "bg-foreground text-background" : "hover:bg-muted/50")}
    >
      <td className={td}>
        <span className={cn("font-condensed tabular", top3 ? "text-[19px]" : "text-[15px]", me ? "text-background" : top3 ? "text-foreground" : "text-ink-2")}>
          {formatInteger(e.rank)}
        </span>
      </td>
      <td className={td}>
        <div className="flex min-w-0 items-center gap-2">
          <Identicon username={e.username} size={24} />
          <Link href={`/u/${e.username}`} className={cn("truncate font-medium hover:underline", me && "text-background")}>
            {e.username}
          </Link>
          <VerifiedIcon share={e.verified_share} inverted={me} />
          {me && <span className="shrink-0 rounded-full border border-current px-1.5 text-[11px] leading-[18px] font-semibold">you</span>}
          {note && <span className="hidden truncate text-xs text-background/75 sm:inline">{note}</span>}
        </div>
      </td>
      <td className={cn(td, "text-right")}>
        <div className="font-medium tabular" title={`${formatInteger(e.total_tokens)} tokens`}>
          {formatTokens(e.total_tokens)}
        </div>
        <div className="mt-1 flex justify-end" aria-hidden>
          <span className={cn("h-[3px] rounded-full", me ? "bg-background" : "bg-foreground")} style={{ width: `${barWidth}%` }} />
        </div>
      </td>
      {!compact && (
        <td className={cn(td, "hidden min-[640px]:table-cell")}>
          <MixBar mix={e.category_mix} selected={category} />
        </td>
      )}
      {!compact && (
        <td className={cn(td, "tabular whitespace-nowrap")}>
          {e.current_streak > 0 ? streakText(e.current_streak) : <span className={me ? "text-background/70" : "text-muted-foreground"}>None</span>}
        </td>
      )}
      {!compact && (
        <td className={cn(td, "hidden truncate min-[640px]:table-cell")} title={apps.title}>
          {apps.first}
          {apps.more > 0 && <span className={me ? "text-background/70" : "text-muted-foreground"}> +{apps.more}</span>}
        </td>
      )}
    </tr>
  );
}

