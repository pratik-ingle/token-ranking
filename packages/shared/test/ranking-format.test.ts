import { describe, expect, it } from "vitest";
import { assignRanks, formatPercentile, formatTokens, hypotheticalRank, pageForRank, percentileLabel, topPercent } from "../src";

describe("assignRanks", () => {
  it("uses competition ranking for ties (1224)", () => {
    const ranked = assignRanks(
      [
        { u: "d", t: 50 },
        { u: "a", t: 100 },
        { u: "c", t: 80 },
        { u: "b", t: 80 },
        { u: "e", t: 10 },
      ],
      (x) => x.t,
      (x, y) => x.u.localeCompare(y.u),
    );
    expect(ranked.map((r) => [r.u, r.rank])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 2],
      ["d", 4],
      ["e", 5],
    ]);
  });

  it("gives everybody rank 1 when all tie", () => {
    expect(assignRanks([{ t: 5 }, { t: 5 }, { t: 5 }], (x) => x.t).map((r) => r.rank)).toEqual([1, 1, 1]);
  });

  it("computes hypothetical ranks for hidden users", () => {
    expect(hypotheticalRank(80, [100, 80, 50])).toEqual({ rank: 2, total: 4 });
    expect(hypotheticalRank(1000, [100, 80])).toEqual({ rank: 1, total: 3 });
    expect(hypotheticalRank(0, [])).toEqual({ rank: 1, total: 1 });
  });
});

describe("percentiles", () => {
  it("labels top percent and rounds up", () => {
    expect(formatPercentile(1, 1)).toBe("Top 100%");
    expect(formatPercentile(3, 100)).toBe("Top 3%");
    expect(formatPercentile(31, 1000)).toBe("Top 4%"); // 3.1% -> 4%
    expect(formatPercentile(1, 500)).toBe("Top 0.2%");
    expect(formatPercentile(1, 100_000)).toBe("Top 0.1%");
    expect(formatPercentile(21, 10_000)).toBe("Top 0.3%"); // 0.21% -> 0.3%
    expect(formatPercentile(50, 100)).toBe("Top 50%");
    expect(formatPercentile(100, 100)).toBe("Top 100%");
  });

  it("gives tied users the same label", () => {
    const ranked = assignRanks([{ t: 9 }, { t: 7 }, { t: 7 }, { t: 1 }], (x) => x.t);
    const labels = ranked.map((r) => formatPercentile(r.rank, ranked.length));
    expect(labels).toEqual(["Top 25%", "Top 50%", "Top 50%", "Top 100%"]);
  });

  it("handles empty populations", () => {
    expect(percentileLabel(null, 10)).toBeNull();
    expect(percentileLabel(1, 0)).toBeNull();
    expect(topPercent(0, 0)).toBe(100);
  });

  it("finds the page for a rank", () => {
    expect(pageForRank(1, 50)).toBe(1);
    expect(pageForRank(50, 50)).toBe(1);
    expect(pageForRank(51, 50)).toBe(2);
  });
});

describe("formatTokens", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [1000, "1K"],
    [12_345, "12.3K"],
    [99_940, "99.9K"],
    [99_960, "100K"],
    [123_456, "123K"],
    [999_950, "1M"],
    [1_200_000, "1.2M"],
    [3_400_000_000, "3.4B"],
    [2_500_000_000_000, "2.5T"],
    [-1500, "-1.5K"],
  ])("%d -> %s", (n, s) => {
    expect(formatTokens(n)).toBe(s);
  });
});
