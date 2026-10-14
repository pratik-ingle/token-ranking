import { formatInteger, formatTokens, SOURCE_LABELS, type LeaderboardEntry, type Source } from "@tokenrank/shared";
import { BadgeCheck, Flame } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Identicon } from "./identicon";

export function VerifiedBadge({ share }: { share: number }) {
  if (share <= 0) return <span className="text-xs text-muted-foreground">self-reported</span>;
  const full = share >= 0.999;
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-xs", full ? "text-primary" : "text-muted-foreground")}
      title={full ? "All tokens in this view were pulled by TokenRank from a provider API" : `${Math.round(share * 100)}% verified`}
    >
      <BadgeCheck className="size-3.5" />
      {full ? "verified" : `${Math.round(share * 100)}% verified`}
    </span>
  );
}

export function LeaderboardTable({
  entries,
  highlight,
  compact = false,
  stickyMe,
  meHidden = false,
}: {
  entries: LeaderboardEntry[];
  highlight?: string | null;
  compact?: boolean;
  stickyMe?: (LeaderboardEntry & { percentile_label: string; listed: boolean }) | null;
  meHidden?: boolean;
}) {
  const showSticky = stickyMe && !entries.some((e) => e.username === stickyMe.username);
  return (
    <>
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[22rem] table-fixed text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="w-20 px-4 py-2.5 font-medium">Rank</th>
            <th scope="col" className="px-4 py-2.5 font-medium">User</th>
            <th scope="col" className="w-28 px-4 py-2.5 text-right font-medium">Tokens</th>
            {!compact && <th scope="col" className="hidden w-36 px-4 py-2.5 font-medium md:table-cell">Top source</th>}
            {!compact && <th scope="col" className="hidden w-24 px-4 py-2.5 text-right font-medium sm:table-cell">Streak</th>}
            {!compact && <th scope="col" className="hidden w-40 px-4 py-2.5 font-medium lg:table-cell">Data</th>}
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <Row key={e.username} e={e} compact={compact} me={e.username === highlight} />
          ))}
          {entries.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">Nobody here yet for this filter.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
    {showSticky && stickyMe && (
      <div className="sticky bottom-3 z-10 overflow-x-auto rounded-xl border-2 border-primary/40 bg-accent shadow-lg">
        <table className="w-full min-w-[22rem] table-fixed text-sm">
          <tbody>
            <tr>
              <RowCells
                e={stickyMe}
                compact={compact}
                me
                suffix={
                  stickyMe.listed
                    ? stickyMe.percentile_label
                    : `${stickyMe.percentile_label} · ${meHidden ? "hidden, not listed" : "listed after the next refresh"}`
                }
              />
            </tr>
          </tbody>
        </table>
      </div>
    )}
    </>
  );
}

function Row({ e, compact, me }: { e: LeaderboardEntry; compact: boolean; me: boolean }) {
  return (
    <tr id={me ? "me" : undefined} className={cn("border-b last:border-0", me ? "bg-accent" : "hover:bg-muted/40")}>
      <RowCells e={e} compact={compact} me={me} />
    </tr>
  );
}

function RowCells({ e, compact, me, suffix }: { e: LeaderboardEntry; compact: boolean; me: boolean; suffix?: string }) {
  return (
    <>
      <td className="w-20 px-4 py-2.5 tabular font-medium">
        <span className={cn(e.rank <= 3 && "text-primary")}>{formatInteger(e.rank)}</span>
      </td>
      <td className="px-4 py-2.5">
        <Link href={`/u/${e.username}`} className="flex min-w-0 items-center gap-2.5 font-medium hover:underline">
          <Identicon username={e.username} size={24} />
          <span className="truncate">{e.username}</span>
          {me && <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary-foreground">You</span>}
          {suffix && <span className="truncate text-xs font-normal text-muted-foreground">{suffix}</span>}
        </Link>
      </td>
      <td className="w-28 px-4 py-2.5 text-right tabular font-medium" title={`${formatInteger(e.total_tokens)} tokens`}>
        {formatTokens(e.total_tokens)}
      </td>
      {!compact && (
        <td className="hidden w-36 truncate px-4 py-2.5 text-muted-foreground md:table-cell">
          {e.top_source ? (SOURCE_LABELS[e.top_source as Source] ?? e.top_source) : "—"}
        </td>
      )}
      {!compact && (
        <td className="hidden w-24 px-4 py-2.5 text-right tabular sm:table-cell">
          {e.current_streak > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Flame className="size-3.5 text-[var(--series-2)]" aria-hidden />
              {e.current_streak}d
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
      )}
      {!compact && (
        <td className="hidden w-40 px-4 py-2.5 lg:table-cell">
          <VerifiedBadge share={e.verified_share} />
        </td>
      )}
    </>
  );
}
