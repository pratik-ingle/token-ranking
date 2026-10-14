"use client";

import { formatInteger } from "@tokenrank/shared";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** One digit cell: a vertical reel of 0–9 shifted by --d. Starts at 0 and rolls to `digit`. */
function Reel({ digit, index }: { digit: number; index: number }) {
  const [d, setD] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setD(digit));
    return () => cancelAnimationFrame(id);
  }, [digit]);
  return (
    <span
      className="relative inline-block h-[1.22em] w-[0.6em] overflow-hidden rounded-[0.12em] bg-card shadow-[inset_0_0_0_1px_var(--line)] [mask-image:linear-gradient(to_bottom,transparent,#000_20%,#000_80%,transparent)]"
      style={{ ["--d" as string]: d }}
    >
      <span
        className="absolute inset-x-0 top-0 flex flex-col transition-transform duration-[1200ms] ease-[cubic-bezier(.16,.84,.24,1)] motion-reduce:transition-none"
        style={{ transform: "translateY(calc(var(--d) * -1.22em))", transitionDelay: `${index * 40}ms` }}
      >
        {DIGITS.map((n) => (
          <span key={n} className="block h-[1.22em] text-center leading-[1.22em]">
            {n}
          </span>
        ))}
      </span>
    </span>
  );
}

/**
 * Rolling-digit counter. Digits are grouped in threes with a small gap. Cells
 * are rebuilt only when the grouping (digit count) changes; otherwise each
 * reel just rolls to its new digit. No motion under prefers-reduced-motion.
 */
export function Odometer({ value, size = "default", unit = "tokens", className }: { value: number; size?: "default" | "sm"; unit?: string; className?: string }) {
  const safe = Math.max(0, Math.round(value));
  const groups = formatInteger(safe).split(",");
  const layout = groups.map((g) => g.length).join("-");
  let index = 0;
  return (
    <span
      role="img"
      aria-label={`${formatInteger(safe)} ${unit}`}
      className={cn(
        "inline-flex items-center font-condensed tabular leading-none text-foreground",
        size === "sm" ? "gap-[0.16em] text-[clamp(26px,4.6vw,46px)]" : "gap-[0.2em] text-[clamp(30px,7.4vw,78px)]",
        className,
      )}
    >
      <span aria-hidden className="contents">
        {groups.map((group, gi) => (
          <span key={`${layout}:${gi}`} className="inline-flex gap-[0.05em]">
            {[...group].map((ch, ci) => {
              const i = index++;
              return <Reel key={`${layout}:${gi}:${ci}`} digit={Number(ch)} index={i} />;
            })}
          </span>
        ))}
      </span>
    </span>
  );
}
