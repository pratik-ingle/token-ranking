import { formatInteger, type Category, type LeaderboardResponse, type LeaderboardWindow } from "@tokenrank/shared";
import Link from "next/link";
import { CATEGORY_SHORT, WINDOW_PHRASE } from "@/lib/categories";
import { Odometer } from "./odometer";
import { buttonVariants } from "./ui/button";

type Me = LeaderboardResponse["me"];
type HeroUser = { username: string; visibility: "public" | "hidden" } | null;

/** Odometer of the board total for the current filter, plus a rank card. */
export function LeaderboardHero({
  boardTotal,
  totalRanked,
  window,
  category,
  me,
  user,
}: {
  boardTotal: number;
  totalRanked: number;
  window: LeaderboardWindow;
  category: Category | "all";
  me: Me;
  user: HeroUser;
}) {
  const only = category === "all" ? "" : `, ${CATEGORY_SHORT[category].toLowerCase()} only`;
  return (
    <section
      aria-label="Board total and your rank"
      className="flex flex-col gap-6 min-[760px]:flex-row min-[760px]:items-end min-[760px]:justify-between"
    >
      <div className="min-w-0 space-y-3">
        <h1 className="sr-only">Leaderboard</h1>
        <Odometer value={boardTotal} />
        <p className="text-sm text-ink-2">
          tokens burned by everyone on the board {WINDOW_PHRASE[window]}
          {only}
        </p>
      </div>
      <RankCard me={me} user={user} totalRanked={totalRanked} />
    </section>
  );
}

function RankCard({ me, user, totalRanked }: { me: Me; user: HeroUser; totalRanked: number }) {
  const box = "w-full rounded-xl border bg-card p-5 min-[760px]:w-auto min-[760px]:min-w-64";
  if (!user) {
    return (
      <div className={box}>
        <p className="font-medium">Where do you rank?</p>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">All it takes is a username.</p>
        <Link href="/signup" className={buttonVariants()}>Get your rank</Link>
      </div>
    );
  }
  if (!me) {
    return (
      <div className={box}>
        <p className="font-medium">You&apos;re not ranked yet</p>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">Connect an app to join the board.</p>
        <Link href="/onboarding" className={buttonVariants()}>Connect an app</Link>
      </div>
    );
  }
  const hidden = user.visibility === "hidden";
  // Hidden / not-yet-listed users are compared against the listed population plus themselves.
  const of = me.listed ? totalRanked : totalRanked + 1;
  return (
    <div className={box}>
      <p className="text-sm text-ink-2">{hidden ? "You would be ranked" : "You're ranked"}</p>
      <p className="mt-1 font-condensed text-[clamp(40px,6vw,60px)] leading-none tabular">#{formatInteger(me.rank)}</p>
      <p className="mt-2 text-sm text-ink-2">
        of {formatInteger(of)} {of === 1 ? "person" : "people"}, {me.percentile_label.replace(/^Top/, "top")}
      </p>
      {hidden && <p className="mt-1 max-w-64 text-xs text-muted-foreground">Your profile is hidden, so this is where you would stand among public users.</p>}
      {!hidden && !me.listed && <p className="mt-1 text-xs text-muted-foreground">You&apos;ll be listed after the next refresh.</p>}
      <Link href={`/u/${user.username}`} className={buttonVariants({ variant: "outline", size: "sm", className: "mt-4" })}>
        See your profile
      </Link>
    </div>
  );
}
