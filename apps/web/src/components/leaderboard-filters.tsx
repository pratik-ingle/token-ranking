"use client";

import { SOURCES, SOURCE_LABELS, WINDOWS, WINDOW_LABELS, type Category } from "@tokenrank/shared";
import { ChevronDown } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { CATEGORY_SHORT, MORE_CATEGORIES, PRIMARY_CATEGORIES } from "@/lib/categories";
import { cn } from "@/lib/utils";
import { categoryColor } from "./charts/series";
import { Select, Switch } from "./ui/input";

const chip =
  "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm whitespace-nowrap transition-colors aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background";

function Dot({ category }: { category: Category | "all" }) {
  return (
    <span
      aria-hidden
      className={cn("size-2 shrink-0 rounded-full", category === "all" && "border border-current")}
      style={category === "all" ? undefined : { background: categoryColor(category) }}
    />
  );
}

/** Filters live in the URL; every change resets to page 1 (the view mode is kept). */
export function LeaderboardFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const menuId = useId();

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

  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [moreOpen]);

  const window = get("window", "30d");
  const category = get("category", "all") as Category | "all";
  const visibleChips: Array<Category | "all"> = ["all", ...PRIMARY_CATEGORIES];
  if (MORE_CATEGORIES.includes(category as Category)) visibleChips.push(category);
  const setCategory = (c: Category | "all") => update({ category: c === "all" ? null : c });

  return (
    <div className={cn("space-y-3 transition-opacity", pending && "opacity-60")} aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex max-w-full overflow-x-auto rounded-md border bg-card p-0.5" role="group" aria-label="Time window">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={window === w}
              onClick={() => update({ window: w })}
              className={cn(
                "h-8 shrink-0 rounded-[8px] px-2.5 text-sm whitespace-nowrap sm:px-3",
                window === w ? "bg-foreground font-medium text-background" : "text-ink-2 hover:text-foreground",
              )}
            >
              {WINDOW_LABELS[w]}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Category">
          {visibleChips.map((c) => (
            <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)} className={cn(chip, "bg-card hover:border-foreground/40")}>
              <Dot category={c} />
              {c === "all" ? "All" : CATEGORY_SHORT[c]}
            </button>
          ))}
          <div ref={moreRef} className="relative">
            <button
              ref={moreButton}
              type="button"
              aria-expanded={moreOpen}
              aria-controls={menuId}
              onClick={() => setMoreOpen((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setMoreOpen(false);
              }}
              className={cn(chip, "bg-card text-ink-2 hover:border-foreground/40")}
            >
              More <ChevronDown className="size-3.5" aria-hidden />
            </button>
            {moreOpen && (
              <div
                id={menuId}
                className="absolute right-0 z-20 mt-1.5 flex min-w-40 flex-col gap-0.5 rounded-md border bg-card p-1"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setMoreOpen(false);
                    moreButton.current?.focus();
                  }
                }}
              >
                {MORE_CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={category === c}
                    onClick={() => {
                      setMoreOpen(false);
                      setCategory(c);
                    }}
                    className="flex h-8 items-center gap-2 rounded-[8px] px-2.5 text-left text-sm hover:bg-muted aria-pressed:font-semibold"
                  >
                    <Dot category={c} />
                    {CATEGORY_SHORT[c]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <label className="flex items-center gap-2">
          Source
          <Select
            aria-label="Source"
            className="h-8 text-xs"
            value={get("source", "all")}
            onChange={(e) => update({ source: e.target.value === "all" ? null : e.target.value })}
          >
            <option value="all">All sources</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
            ))}
          </Select>
        </label>
        <Switch id="verified" label="Verified only" checked={get("verified", "false") === "true"} onCheckedChange={(v) => update({ verified: v ? "true" : null })} />
        <Switch id="cache" label="Include cache tokens" checked={get("cache", "true") !== "false"} onCheckedChange={(v) => update({ cache: v ? null : "false" })} />
      </div>
    </div>
  );
}
