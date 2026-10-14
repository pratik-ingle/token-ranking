import { buildHeatmap, formatHeatmapDate, formatInteger, formatTokens, localDate, WINDOW_LABELS, type LeaderboardWindow } from "@tokenrank/shared";
import { AlertTriangle, BadgeCheck, CalendarDays, Flame, Globe2, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BreakdownBar } from "@/components/charts/breakdown-bar";
import { ModelBars } from "@/components/charts/model-bars";
import { TrendChart } from "@/components/charts/trend-chart";
import { Heatmap } from "@/components/heatmap";
import { Identicon } from "@/components/identicon";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/db/client";
import { cn } from "@/lib/utils";
import { getHeatmap, getUserByUsername, getUserStats } from "@/server/leaderboard";
import { getCurrentUser } from "@/server/session";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ username: string }>; searchParams: Promise<{ year?: string; cache?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  return { title: username };
}

export default async function ProfilePage({ params, searchParams }: Props) {
  const { username } = await params;
  const sp = await searchParams;
  const db = getDb();
  const [user, me] = await Promise.all([getUserByUsername(db, username), getCurrentUser()]);
  const isMe = Boolean(me && user && me.id === user.id);
  if (!user || (user.visibility === "hidden" && !isMe)) notFound();

  const yearNum = sp.year ? Number(sp.year) : null;
  const year = yearNum && Number.isInteger(yearNum) && yearNum >= 2020 && yearNum <= 2100 ? yearNum : null;
  const cache = sp.cache !== "false";
  const [stats, heat] = await Promise.all([getUserStats(db, user, { cache }), getHeatmap(db, user, year)]);
  const today = localDate(Date.now(), user.timezone);
  const grid = buildHeatmap({ days: heat.days, today, year });
  const noData = stats.totals.total_tokens === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <Identicon username={user.username} size={64} className="rounded-xl" />
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
            {user.username}
            {isMe && <Badge variant="secondary">You</Badge>}
            {user.visibility === "hidden" && <Badge variant="outline">Hidden from leaderboard</Badge>}
          </h1>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1"><CalendarDays className="size-4" /> Joined {formatHeatmapDate(localDate(user.createdAt, user.timezone))}</span>
            <span className="inline-flex items-center gap-1"><Globe2 className="size-4" /> Days counted in {user.timezone}</span>
            {stats.verified_share > 0 && (
              <span className="inline-flex items-center gap-1 text-primary"><BadgeCheck className="size-4" /> {Math.round(stats.verified_share * 100)}% verified</span>
            )}
          </p>
        </div>
        {isMe && (
          <Link href="/settings" className="ml-auto text-sm text-primary hover:underline">Settings →</Link>
        )}
      </div>

      {stats.flagged_days > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--status-warning)]/50 bg-[var(--status-warning)]/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong>Under review:</strong> {stats.flagged_days} day{stats.flagged_days === 1 ? "" : "s"} exceeded our per-source sanity limits and
            {stats.flagged_days === 1 ? " is" : " are"} excluded from rankings and these totals until a moderator reviews {stats.flagged_days === 1 ? "it" : "them"}.
          </span>
        </div>
      )}

      {noData && isMe && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <p className="text-sm">No usage yet. Connect a tool to get on the board.</p>
            <Link href="/onboarding" className="text-sm font-medium text-primary hover:underline">Connect a tool →</Link>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Total tokens" value={formatTokens(stats.totals.total_tokens)} hint={`${formatTokens(stats.totals.input_tokens + stats.totals.output_tokens)} excluding cache`} />
        <Kpi label="Current streak" value={`${stats.streaks.current} day${stats.streaks.current === 1 ? "" : "s"}`} hint="Ends today or yesterday" icon={<Flame className="size-4 text-[var(--series-2)]" />} />
        <Kpi label="Longest streak" value={`${stats.streaks.longest} day${stats.streaks.longest === 1 ? "" : "s"}`} hint="Consecutive active days" />
        <Kpi label="Active days" value={formatInteger(stats.streaks.active_days)} hint={`${formatInteger(stats.totals.request_count)} requests${stats.totals.image_count ? ` · ${formatInteger(stats.totals.image_count)} images` : ""}`} />
      </div>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><Trophy className="size-4 text-primary" /> Rank</CardTitle>
          <div className="flex gap-1 text-xs">
            <Link href={`?${new URLSearchParams({ ...(year ? { year: String(year) } : {}) })}`} className={cn("rounded px-2 py-1", cache ? "bg-muted font-medium" : "text-muted-foreground")}>With cache</Link>
            <Link href={`?${new URLSearchParams({ ...(year ? { year: String(year) } : {}), cache: "false" })}`} className={cn("rounded px-2 py-1", !cache ? "bg-muted font-medium" : "text-muted-foreground")}>Without cache</Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {stats.windows.map((w) => (
              <div key={w.window} className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">{WINDOW_LABELS[w.window as LeaderboardWindow]}</div>
                <div className="mt-1 text-xl font-semibold">{w.rank ? `#${formatInteger(w.rank)}` : "—"}</div>
                <div className="text-xs text-muted-foreground">
                  {w.percentile_label ?? "Not ranked"} · {formatTokens(w.total_tokens)}
                </div>
              </div>
            ))}
          </div>
          {user.visibility === "hidden" && (
            <p className="mt-3 text-xs text-muted-foreground">Your profile is hidden, so these are the ranks you would have among public users.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 pb-3">
          <div>
            <CardTitle className="text-base">Activity</CardTitle>
            <CardDescription>{year ? `${year}` : "Last 365 days"} · tokens per day in {user.timezone}</CardDescription>
          </div>
          <nav className="flex flex-wrap gap-1 text-xs" aria-label="Heatmap year">
            <Link href={`/u/${user.username}`} className={cn("rounded px-2 py-1", !year ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}>Last 365 days</Link>
            {heat.available_years.map((y) => (
              <Link key={y} href={`/u/${user.username}?year=${y}`} className={cn("rounded px-2 py-1", year === y ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}>{y}</Link>
            ))}
          </nav>
        </CardHeader>
        <CardContent>
          <Heatmap grid={grid} caption={`${user.username}'s token activity heatmap: ${grid.active_days} active days, ${formatTokens(grid.total_tokens)} tokens`} />
          <p className="mt-2 text-xs text-muted-foreground">
            Shades are quartiles of {isMe ? "your" : `${user.username}'s`} own active days, so light and heavy users both get the full range.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">By source</CardTitle></CardHeader>
          <CardContent><BreakdownBar items={stats.by_source} dimension="source" title="Tokens by source" /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">By category</CardTitle></CardHeader>
          <CardContent><BreakdownBar items={stats.by_category} dimension="category" title="Tokens by category" /></CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Daily tokens</CardTitle>
            <CardDescription>Last 90 days</CardDescription>
          </CardHeader>
          <CardContent>
            <TrendChart data={stats.daily} />
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-muted-foreground">Show as table</summary>
              <div className="mt-2 max-h-64 overflow-y-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted text-left"><tr><th className="px-3 py-1.5">Date</th><th className="px-3 py-1.5 text-right">Tokens</th></tr></thead>
                  <tbody>
                    {[...stats.daily].reverse().map((d) => (
                      <tr key={d.date} className="border-t"><td className="px-3 py-1">{formatHeatmapDate(d.date)}</td><td className="px-3 py-1 text-right tabular">{formatInteger(d.total_tokens)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Top models</CardTitle></CardHeader>
          <CardContent><ModelBars items={stats.top_models} /></CardContent>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ label, value, hint, icon }: { label: string; value: string; hint: string; icon?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-5">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">{icon}{label}</p>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
