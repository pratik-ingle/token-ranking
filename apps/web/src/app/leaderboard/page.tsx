import { formatInteger, leaderboardQuerySchema, SOURCE_LABELS, WINDOW_LABELS, type Category, type Source } from "@tokenrank/shared";
import { ChevronLeft, ChevronRight, Crosshair } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LeaderboardFilters } from "@/components/leaderboard-filters";
import { LeaderboardHero } from "@/components/leaderboard-hero";
import { LeaderboardTable, type TableRow } from "@/components/leaderboard-table";
import { buttonVariants } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { CATEGORY_SHORT } from "@/lib/categories";
import { timeAgo } from "@/lib/utils";
import { filterFromQuery, getContextView, getLeaderboard } from "@/server/leaderboard";
import { getCurrentUser } from "@/server/session";

export const metadata: Metadata = { title: "Leaderboard" };
export const dynamic = "force-dynamic";

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = Object.fromEntries(
    Object.entries(await searchParams)
      .map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])
      .filter(([, v]) => v !== undefined),
  ) as Record<string, string>;
  const parsed = leaderboardQuerySchema.safeParse(raw);
  const q = parsed.success ? parsed.data : leaderboardQuerySchema.parse({});
  const user = await getCurrentUser();
  const db = getDb();
  const data = await getLeaderboard(db, q, user);
  const f = filterFromQuery(q);
  const category = q.category as Category | "all";

  // "You in context" is the default for a signed-in, listed user on page 1.
  const fullView = raw.view === "all" || !user || q.page > 1 || !data.me?.listed || !data.me.position;
  let rows: TableRow[];
  let scopeNote: string;
  if (!fullView && data.me?.position) {
    const ctx = await getContextView(db, f, data.me.position);
    rows = [
      ...ctx.top.map((entry) => ({ kind: "entry" as const, entry })),
      ...(ctx.in_between ? [{ kind: "gap" as const, count: ctx.in_between }] : []),
      ...ctx.neighbours.map((entry) => ({ kind: "entry" as const, entry })),
    ];
    scopeNote = "the top of the board and the people around you";
  } else {
    rows = data.entries.map((entry) => ({ kind: "entry" as const, entry }));
    const first = (q.page - 1) * q.page_size + 1;
    scopeNote = data.entries.length ? `positions ${formatInteger(first)} to ${formatInteger(first + data.entries.length - 1)}` : "no one";
  }

  const pages = Math.max(1, Math.ceil(data.total_ranked / q.page_size));
  const href = (patch: Record<string, string | null>, hash = "") => {
    const p = new URLSearchParams(raw);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    if (p.get("page") === "1") p.delete("page");
    const s = p.toString();
    return `/leaderboard${s ? `?${s}` : ""}${hash}`;
  };

  const filterWords = [
    WINDOW_LABELS[q.window],
    q.source !== "all" ? SOURCE_LABELS[q.source as Source] : "all sources",
    category !== "all" ? `${CATEGORY_SHORT[category]} only` : "all categories",
    q.verified ? "verified only" : null,
    q.cache ? "including cache tokens" : "excluding cache tokens",
  ].filter(Boolean);
  const caption = `Leaderboard for ${filterWords.join(", ")}: ${formatInteger(data.total_ranked)} ranked; showing ${scopeNote}.`;

  const showSticky = data.me && (!data.me.listed || (fullView && !data.entries.some((e) => e.username === data.me!.username)));
  const stickyNote = data.me
    ? user?.visibility === "hidden"
      ? `${data.me.percentile_label} · hidden, not listed`
      : !data.me.listed
        ? `${data.me.percentile_label} · listed after the next refresh`
        : data.me.percentile_label
    : "";

  return (
    <div className="space-y-8">
      <LeaderboardHero
        boardTotal={data.board_total_tokens}
        totalRanked={data.total_ranked}
        window={q.window}
        category={category}
        me={data.me}
        user={user ? { username: user.username, visibility: user.visibility } : null}
      />

      <Suspense>
        <LeaderboardFilters />
      </Suspense>

      <div className="space-y-3">
        <LeaderboardTable
          rows={rows}
          me={user?.username}
          topTotal={data.top_total_tokens}
          category={category}
          caption={caption}
          stickyMe={showSticky && data.me ? { entry: data.me, note: stickyNote } : null}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-muted-foreground">
          {formatInteger(data.total_ranked)} ranked{data.refreshed_at ? ` · updated ${timeAgo(data.refreshed_at)}` : ""}. Windows use each
          person&apos;s own timezone; days over our sanity limits are held for review.
        </p>
        {fullView ? (
          <nav className="flex flex-wrap items-center gap-2" aria-label="Pagination">
            {data.me?.listed && (
              <Link href={href({ view: "all", page: String(data.me.page) }, "#me")} className={buttonVariants({ variant: "outline", size: "sm" })}>
                <Crosshair aria-hidden /> Jump to my rank
              </Link>
            )}
            <Link
              aria-disabled={q.page <= 1}
              tabIndex={q.page <= 1 ? -1 : undefined}
              href={href({ view: "all", page: String(q.page - 1) })}
              className={buttonVariants({ variant: "outline", size: "sm", className: q.page <= 1 ? "pointer-events-none opacity-50" : "" })}
            >
              <ChevronLeft aria-hidden /> Prev
            </Link>
            <span className="tabular text-muted-foreground">
              Page {q.page} of {pages}
            </span>
            <Link
              aria-disabled={q.page >= pages}
              tabIndex={q.page >= pages ? -1 : undefined}
              href={href({ view: "all", page: String(q.page + 1) })}
              className={buttonVariants({ variant: "outline", size: "sm", className: q.page >= pages ? "pointer-events-none opacity-50" : "" })}
            >
              Next <ChevronRight aria-hidden />
            </Link>
          </nav>
        ) : (
          <Link href={href({ view: "all", page: null })} className="font-medium underline-offset-4 hover:underline">
            Browse the full leaderboard →
          </Link>
        )}
      </div>
    </div>
  );
}
