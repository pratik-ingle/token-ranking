import {
  formatHeatmapDate,
  formatInteger,
  formatTokens,
  localDate,
  MONTH_SHORT,
  parseDate,
  WINDOW_LABELS,
  type LeaderboardWindow,
} from "@tokenrank/shared";
import { AlertTriangle, BadgeCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BreakdownRows } from "@/components/charts/breakdown-rows";
import { ModelBars } from "@/components/charts/model-bars";
import { TrendChart } from "@/components/charts/trend-chart";
import { Heatmap } from "@/components/heatmap";
import { Identicon } from "@/components/identicon";
import { Odometer } from "@/components/odometer";
import { Badge } from "@/components/ui/badge";
import { getDb } from "@/db/client";
import { APP_ENTRIES } from "@/lib/integrations-catalog";
import { cn } from "@/lib/utils";
import { connectedSources } from "@/server/integrations";
import { getHeatmap, getUserByUsername, getUserStats } from "@/server/leaderboard";
import { getCurrentUser } from "@/server/session";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ username: string }>; searchParams: Promise<{ year?: string; cache?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  return { title: username };
}

function shortDate(date: string): string {
  const d = new Date(parseDate(date));
  return `${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
}

const panel = "rounded-xl border bg-card p-5";

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
  const [stats, heat, connected] = await Promise.all([
    getUserStats(db, user, { cache }),
    getHeatmap(db, user, year),
    isMe ? connectedSources(db, user) : Promise.resolve(null),
  ]);
  const today = localDate(Date.now(), user.timezone);
  const yearRank = stats.windows.find((w) => w.window === "year");
  const hidden = user.visibility === "hidden";
  const noData = stats.totals.total_tokens === 0;
  const notConnected = connected ? APP_ENTRIES.filter((e) => !connected.has(e.source)).map((e) => e.name) : [];
  const cacheHref = (c: boolean) => `?${new URLSearchParams({ ...(year ? { year: String(year) } : {}), ...(c ? {} : { cache: "false" }) })}`;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex min-w-0 items-center gap-4">
          <Identicon username={user.username} size={56} className="rounded-xl" />
          <div className="min-w-0">
            <h1 className="truncate font-expanded text-[clamp(26px,4.4vw,46px)] leading-[1.05] font-[850]">{user.username}</h1>
            <p className="mt-2 text-ink-2">
              {yearRank?.rank ? (
                <>
                  {hidden ? "Would rank" : "Rank"} #{formatInteger(yearRank.rank)} of {formatInteger(yearRank.ranked_users)} this year,{" "}
                  {yearRank.percentile_label?.replace(/^Top/, "top")}
                </>
              ) : isMe && noData ? (
                <>
                  Not ranked yet. <Link href="/onboarding" className="font-medium text-foreground underline underline-offset-4">Connect an app to start.</Link>
                </>
              ) : (
                "Not ranked this year yet."
              )}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>Joined {formatHeatmapDate(localDate(user.createdAt, user.timezone))}</span>
              <span>Days counted in {user.timezone}</span>
              {stats.verified_share > 0 && (
                <span className="inline-flex items-center gap-1">
                  <BadgeCheck className="size-3.5" aria-hidden /> {Math.round(stats.verified_share * 100)}% verified
                </span>
              )}
              {isMe && <Badge variant="secondary">You</Badge>}
              {hidden && <Badge variant="outline">Hidden from the leaderboard</Badge>}
            </p>
          </div>
        </div>
        <div className="min-[640px]:text-right">
          <Odometer value={yearRank?.total_tokens ?? 0} size="sm" />
          <p className="mt-2 text-xs text-ink-2">tokens this year{cache ? "" : ", excluding cache"}</p>
        </div>
      </header>

      {stats.flagged_days > 0 && (
        <div role="note" className="flex items-start gap-2 rounded-xl border border-warning/60 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <strong>Under review:</strong> {stats.flagged_days} day{stats.flagged_days === 1 ? "" : "s"} exceeded our per-source sanity limits and
            {stats.flagged_days === 1 ? " is" : " are"} excluded from rankings and these totals until a moderator reviews{" "}
            {stats.flagged_days === 1 ? "it" : "them"}.
          </span>
        </div>
      )}

      <section aria-label="Activity stats" className="space-y-2">
        <dl className="grid grid-cols-2 rounded-xl border bg-card min-[700px]:grid-cols-4">
          <Stat label="Current streak" value={formatInteger(stats.streaks.current)} unit={stats.streaks.current === 1 ? "day" : "days"} index={0} />
          <Stat label="Longest streak" value={formatInteger(stats.streaks.longest)} unit={stats.streaks.longest === 1 ? "day" : "days"} index={1} />
          <Stat label="Active days" value={formatInteger(stats.streaks.active_days)} unit={stats.streaks.active_days === 1 ? "day" : "days"} index={2} />
          <Stat
            label="Busiest day"
            value={stats.busiest_day ? formatTokens(stats.busiest_day.total_tokens) : "None"}
            unit={stats.busiest_day ? shortDate(stats.busiest_day.date) : ""}
            title={stats.busiest_day ? `${formatInteger(stats.busiest_day.total_tokens)} tokens on ${formatHeatmapDate(stats.busiest_day.date)}` : undefined}
            index={3}
          />
        </dl>
        <p className="text-xs text-muted-foreground">
          {formatTokens(stats.totals.total_tokens)} tokens in total · {formatTokens(stats.totals.input_tokens + stats.totals.output_tokens)} excluding cache ·{" "}
          {formatInteger(stats.totals.request_count)} requests{stats.totals.image_count ? ` · ${formatInteger(stats.totals.image_count)} images` : ""}
        </p>
      </section>

      <section aria-labelledby="ranks-heading" className={panel}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 id="ranks-heading" className="font-semibold">Rank</h2>
          <div className="inline-flex rounded-md border bg-card p-0.5 text-xs" role="group" aria-label="Cache tokens">
            <Link href={cacheHref(true)} aria-current={cache ? "true" : undefined} className={cn("rounded-[8px] px-2.5 py-1.5", cache ? "bg-foreground text-background" : "text-ink-2")}>
              With cache
            </Link>
            <Link href={cacheHref(false)} aria-current={!cache ? "true" : undefined} className={cn("rounded-[8px] px-2.5 py-1.5", !cache ? "bg-foreground text-background" : "text-ink-2")}>
              Without cache
            </Link>
          </div>
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {stats.windows.map((w) => (
            <li key={w.window} className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">{WINDOW_LABELS[w.window as LeaderboardWindow]}</div>
              <div className="mt-1 font-condensed text-[28px] leading-none tabular">{w.rank ? `#${formatInteger(w.rank)}` : "—"}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {w.percentile_label ?? "Not ranked"} · {formatTokens(w.total_tokens)}
              </div>
            </li>
          ))}
        </ul>
        {hidden && <p className="mt-3 text-xs text-muted-foreground">Your profile is hidden, so these are the ranks you would have among public users.</p>}
      </section>

      <section aria-labelledby="heat-heading" className={panel}>
        <Heatmap
          days={heat.days}
          today={today}
          year={year}
          title={
            <div>
              <h2 id="heat-heading" className="font-semibold">Daily tokens</h2>
              <p className="text-xs text-muted-foreground">{year ? year : "Last 365 days"} · counted in {user.timezone}</p>
            </div>
          }
          label={`${user.username}'s daily tokens heatmap, ${year ? year : "last 365 days"}`}
          footer={
            <nav className="flex flex-wrap gap-1 text-xs" aria-label="Heatmap year">
              <Link href={`/u/${user.username}${cache ? "" : "?cache=false"}`} aria-current={!year ? "page" : undefined} className={cn("rounded-[8px] px-2 py-1", !year ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}>
                Last 365 days
              </Link>
              {heat.available_years.map((y) => (
                <Link
                  key={y}
                  href={`/u/${user.username}?year=${y}${cache ? "" : "&cache=false"}`}
                  aria-current={year === y ? "page" : undefined}
                  className={cn("rounded-[8px] px-2 py-1", year === y ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}
                >
                  {y}
                </Link>
              ))}
            </nav>
          }
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="cat-heading" className={panel}>
          <h2 id="cat-heading" className="mb-4 font-semibold">By category</h2>
          <BreakdownRows items={stats.by_category} kind="category" label="Tokens by category" />
        </section>
        <section aria-labelledby="app-heading" className={panel}>
          <h2 id="app-heading" className="mb-4 font-semibold">By app</h2>
          <BreakdownRows items={stats.by_source} kind="app" label="Tokens by app" />
          {isMe && notConnected.length > 0 && (
            <p className="mt-4 text-sm text-muted-foreground">
              Not connected: {notConnected.join(", ")}.{" "}
              <Link href="/onboarding" className="font-medium text-foreground underline-offset-4 hover:underline">Connect apps →</Link>
            </p>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <section aria-labelledby="trend-heading" className={panel}>
          <h2 id="trend-heading" className="font-semibold">Daily trend</h2>
          <p className="mb-3 text-xs text-muted-foreground">Last 90 days</p>
          <TrendChart data={stats.daily} />
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-muted-foreground">Show as table</summary>
            <div className="mt-2 max-h-64 overflow-y-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted text-left">
                  <tr>
                    <th className="px-3 py-1.5">Date</th>
                    <th className="px-3 py-1.5 text-right">Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {[...stats.daily].reverse().map((d) => (
                    <tr key={d.date} className="border-t">
                      <td className="px-3 py-1">{formatHeatmapDate(d.date)}</td>
                      <td className="px-3 py-1 text-right tabular">{formatInteger(d.total_tokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
        <section aria-labelledby="models-heading" className={panel}>
          <h2 id="models-heading" className="mb-4 font-semibold">Top models</h2>
          <ModelBars items={stats.top_models} />
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, unit, index, title }: { label: string; value: string; unit: string; index: number; title?: string }) {
  return (
    <div
      className={cn(
        "p-5",
        // 1px vertical separators; under 700px it's a 2×2 grid with a horizontal one too.
        index % 2 === 1 && "border-l",
        index >= 2 && "border-t min-[700px]:border-t-0",
        index === 2 && "min-[700px]:border-l",
      )}
      title={title}
    >
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd className="mt-1.5 flex items-baseline gap-1.5">
        <span className="font-condensed text-[36px] leading-none">{value}</span>
        {unit && <span className="text-sm text-ink-2">{unit}</span>}
      </dd>
    </div>
  );
}
