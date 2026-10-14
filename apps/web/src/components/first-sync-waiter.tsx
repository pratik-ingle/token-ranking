"use client";

import { formatTokens, WINDOW_LABELS, type LeaderboardWindow, type MeRankResponse } from "@tokenrank/shared";
import { Loader2, PartyPopper } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { callApi } from "@/lib/client-api";
import { buttonVariants } from "./ui/button";

/** Polls /api/v1/me/rank until the first upload lands, then shows the rank. */
export function FirstSyncWaiter() {
  const [data, setData] = useState<MeRankResponse | null>(null);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await callApi<MeRankResponse>("/api/v1/me/rank");
        if (!stop) setData(r);
        if (r.windows.some((w) => w.total_tokens > 0)) return;
      } catch {
        /* keep polling */
      }
      if (!stop) setTimeout(tick, 3000);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, []);

  const all = data?.windows.find((w) => w.window === "all");
  // Prefer the broadest window that has a rank (all-time first).
  const best = [...(data?.windows ?? [])].reverse().find((w) => w.rank !== null);
  if (!all || all.total_tokens === 0) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Waiting for your first sync…
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
      <p className="flex items-center gap-2 font-medium">
        <PartyPopper className="size-5 text-primary" /> You&apos;re on the board with {formatTokens(all.total_tokens)} tokens.
      </p>
      <p className="text-sm text-muted-foreground">
        {best?.rank
          ? `${WINDOW_LABELS[best.window as LeaderboardWindow]}: #${best.rank} of ${best.ranked_users} (${best.percentile_label}). Rankings refresh every couple of minutes.`
          : "Your rank appears after the next leaderboard refresh (every couple of minutes)."}
      </p>
      <div className="flex gap-2">
        <Link href={`/u/${data!.username}`} className={buttonVariants({ size: "sm" })}>View my profile</Link>
        <Link href="/leaderboard" className={buttonVariants({ size: "sm", variant: "outline" })}>Leaderboard</Link>
      </div>
    </div>
  );
}
