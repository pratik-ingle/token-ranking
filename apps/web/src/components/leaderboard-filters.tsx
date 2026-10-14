"use client";

import { CATEGORIES, CATEGORY_LABELS, SOURCES, SOURCE_LABELS, WINDOWS, WINDOW_LABELS } from "@tokenrank/shared";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/utils";
import { Select, Switch } from "./ui/input";

/** One filter row above the table; every change resets to page 1 and updates the URL. */
export function LeaderboardFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const get = (k: string, d: string) => params.get(k) ?? d;
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  const window = get("window", "30d");
  return (
    <div className={cn("flex flex-wrap items-center gap-3 transition-opacity", pending && "opacity-60")}>
      <div className="inline-flex rounded-lg border bg-card p-0.5" role="tablist" aria-label="Time window">
        {WINDOWS.map((w) => (
          <button
            key={w}
            role="tab"
            aria-selected={window === w}
            onClick={() => update({ window: w })}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm",
              window === w ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {WINDOW_LABELS[w]}
          </button>
        ))}
      </div>
      <Select aria-label="Source" value={get("source", "all")} onChange={(e) => update({ source: e.target.value === "all" ? null : e.target.value })}>
        <option value="all">All sources</option>
        {SOURCES.map((s) => (
          <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
        ))}
      </Select>
      <Select aria-label="Category" value={get("category", "all")} onChange={(e) => update({ category: e.target.value === "all" ? null : e.target.value })}>
        <option value="all">All categories</option>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
        ))}
      </Select>
      <div className="flex flex-wrap items-center gap-4 sm:ml-auto">
        <Switch id="verified" label="Verified only" checked={get("verified", "false") === "true"} onCheckedChange={(v) => update({ verified: v ? "true" : null })} />
        <Switch id="cache" label="Include cache tokens" checked={get("cache", "true") !== "false"} onCheckedChange={(v) => update({ cache: v ? null : "false" })} />
      </div>
    </div>
  );
}
