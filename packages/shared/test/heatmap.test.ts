import { describe, expect, it } from "vitest";
import { addDays, buildHeatmap, dateRange, dayOfWeek, heatmapLevel, heatmapTooltip, localDate, quantile } from "../src";

describe("buildHeatmap (rolling 365 days)", () => {
  const today = "2026-10-14"; // a Wednesday

  it("renders exactly 365 in-range days in 7x53, including zero days", () => {
    const grid = buildHeatmap({ days: [], today });
    expect(grid.weeks).toHaveLength(53);
    expect(grid.weeks.every((w) => w.length === 7)).toBe(true);
    const inRange = grid.weeks.flat().filter((c) => c.in_range);
    expect(inRange).toHaveLength(365);
    expect(inRange[0]!.date).toBe(addDays(today, -364));
    expect(inRange.at(-1)!.date).toBe(today);
    expect(inRange.every((c) => c.level === 0 && c.total_tokens === 0)).toBe(true);
  });

  it("starts columns on Sunday and keeps dates contiguous", () => {
    const grid = buildHeatmap({ days: [], today });
    const all = grid.weeks.flat();
    expect(dayOfWeek(all[0]!.date)).toBe(0);
    for (let i = 1; i < all.length; i++) expect(all[i]!.date).toBe(addDays(all[i - 1]!.date, 1));
  });

  it("fits in 53 columns for every possible weekday alignment", () => {
    for (let i = 0; i < 7; i++) {
      const t = addDays("2026-01-01", i);
      const grid = buildHeatmap({ days: [], today: t });
      expect(grid.weeks.length).toBe(53);
      expect(grid.weeks.flat().filter((c) => c.in_range)).toHaveLength(365);
    }
  });

  it("assigns quartile levels from the user's own non-zero days", () => {
    const dates = dateRange(addDays(today, -7), today);
    const days = dates.map((date, i) => ({ date, total_tokens: (i + 1) * 100 })); // 100..800
    const grid = buildHeatmap({ days, today });
    const levels = new Map(grid.weeks.flat().filter((c) => c.in_range).map((c) => [c.date, c.level]));
    expect(levels.get(dates[0]!)).toBe(1);
    expect(levels.get(dates[7]!)).toBe(4);
    expect(levels.get(addDays(today, -100))).toBe(0);
    expect(new Set(levels.values())).toEqual(new Set([0, 1, 2, 3, 4]));
    expect(grid.active_days).toBe(8);
    expect(grid.total_tokens).toBe(3600);
  });

  it("ignores days outside the range and sums duplicates", () => {
    const grid = buildHeatmap({
      days: [
        { date: addDays(today, -365), total_tokens: 999 },
        { date: addDays(today, 1), total_tokens: 999 },
        { date: today, total_tokens: 5 },
        { date: today, total_tokens: 5 },
      ],
      today,
    });
    expect(grid.total_tokens).toBe(10);
  });

  it("works with dates bucketed in the user's timezone", () => {
    // 2026-10-14T20:00Z is already Oct 15 in Tokyo; Tokyo's heatmap must end on Oct 15.
    const now = Date.parse("2026-10-14T20:00:00Z");
    const tz = "Asia/Tokyo";
    const t = localDate(now, tz);
    const grid = buildHeatmap({ days: [{ date: t, total_tokens: 42 }], today: t });
    expect(grid.end).toBe("2026-10-15");
    expect(grid.weeks.flat().find((c) => c.date === "2026-10-15")?.level).toBeGreaterThan(0);
  });
});

describe("buildHeatmap (calendar year)", () => {
  it("covers Jan 1 to Dec 31 and marks future days", () => {
    const grid = buildHeatmap({ days: [], today: "2026-10-14", year: 2026 });
    const inRange = grid.weeks.flat().filter((c) => c.in_range);
    expect(inRange).toHaveLength(365);
    expect(inRange[0]!.date).toBe("2026-01-01");
    expect(inRange.at(-1)!.date).toBe("2026-12-31");
    expect(inRange.filter((c) => c.future)).toHaveLength(78);
  });

  it("handles leap years starting on Saturday (54 columns)", () => {
    const grid = buildHeatmap({ days: [], today: "2029-01-01", year: 2028 });
    expect(grid.weeks.flat().filter((c) => c.in_range)).toHaveLength(366);
    expect(grid.weeks.length).toBe(54);
  });

  it("labels months", () => {
    const grid = buildHeatmap({ days: [], today: "2026-12-31", year: 2026 });
    expect(grid.month_labels.map((m) => m.label)).toEqual([
      "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]);
  });
});

describe("heatmap helpers", () => {
  it("formats tooltips", () => {
    expect(heatmapTooltip({ date: "2026-03-04", total_tokens: 2_300_000 })).toBe("2.3M tokens on Mar 4, 2026");
    expect(heatmapTooltip({ date: "2026-03-04", total_tokens: 0 })).toBe("No tokens on Mar 4, 2026");
    expect(heatmapTooltip({ date: "2026-03-04", total_tokens: 1 })).toBe("1 token on Mar 4, 2026");
  });

  it("computes quantiles and levels", () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([], 0.5)).toBe(0);
    expect(heatmapLevel(0, [1, 2, 3])).toBe(0);
    expect(heatmapLevel(1, [1, 2, 3])).toBe(1);
    expect(heatmapLevel(2.5, [1, 2, 3])).toBe(3);
    expect(heatmapLevel(10, [1, 2, 3])).toBe(4);
  });
});
