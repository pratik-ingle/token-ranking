import { CATEGORY_LABELS, formatInteger, leaderboardQuerySchema, SOURCE_LABELS, WINDOW_LABELS, type Category, type Source } from "@tokenrank/shared";
import { ChevronLeft, ChevronRight, Crosshair, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LeaderboardFilters } from "@/components/leaderboard-filters";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { buttonVariants } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { timeAgo } from "@/lib/utils";
import { getLeaderboard } from "@/server/leaderboard";
import { getCurrentUser } from "@/server/session";

export const metadata: Metadata = { title: "Leaderboard" };
export const dynamic = "force-dynamic";

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v !== undefined));
  const parsed = leaderboardQuerySchema.safeParse(raw);
  const q = parsed.success ? parsed.data : leaderboardQuerySchema.parse({});
  const user = await getCurrentUser();
  const data = await getLeaderboard(getDb(), q, user);
  const pages = Math.max(1, Math.ceil(data.total_ranked / q.page_size));

  const href = (page: number) => {
    const p = new URLSearchParams(raw as Record<string, string>);
    if (page <= 1) p.delete("page");
    else p.set("page", String(page));
    const s = p.toString();
    return `/leaderboard${s ? `?${s}` : ""}`;
  };

  const scope = [
    WINDOW_LABELS[q.window],
    q.source !== "all" ? SOURCE_LABELS[q.source as Source] : null,
    q.category !== "all" ? CATEGORY_LABELS[q.category as Category] : null,
    q.verified ? "verified only" : null,
    q.cache ? null : "excluding cache",
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Leaderboard</h1>
          <p className="text-sm text-muted-foreground">
            {formatInteger(data.total_ranked)} ranked · {scope.join(" · ")}
            {data.refreshed_at ? ` · updated ${timeAgo(data.refreshed_at)}` : ""}
          </p>
        </div>
        {data.me ? (
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-medium">You: #{formatInteger(data.me.rank)}</div>
              <div className="text-xs text-muted-foreground">
                {data.me.percentile_label}
                {data.me.listed ? "" : user?.visibility === "hidden" ? " · hidden" : " · listed after the next refresh"}
              </div>
            </div>
            {data.me.listed && (
              <Link href={`${href(data.me.page)}#me`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                <Crosshair /> Jump to my rank
              </Link>
            )}
          </div>
        ) : user ? (
          <Link href="/onboarding" className={buttonVariants({ size: "sm" })}>Connect a tool to get ranked</Link>
        ) : null}
      </div>

      <Suspense>
        <LeaderboardFilters />
      </Suspense>

      <LeaderboardTable entries={data.entries} highlight={user?.username} stickyMe={data.me} meHidden={user?.visibility === "hidden"} />

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <Info className="size-4" />
          Windows use each person&apos;s own timezone. Days over our sanity limits are held for review and not ranked.
        </p>
        <nav className="flex items-center gap-2" aria-label="Pagination">
          <Link aria-disabled={q.page <= 1} href={href(q.page - 1)} className={buttonVariants({ variant: "outline", size: "sm", className: q.page <= 1 ? "pointer-events-none opacity-50" : "" })}>
            <ChevronLeft /> Prev
          </Link>
          <span className="tabular text-muted-foreground">Page {q.page} of {pages}</span>
          <Link aria-disabled={q.page >= pages} href={href(q.page + 1)} className={buttonVariants({ variant: "outline", size: "sm", className: q.page >= pages ? "pointer-events-none opacity-50" : "" })}>
            Next <ChevronRight />
          </Link>
        </nav>
      </div>
    </div>
  );
}
