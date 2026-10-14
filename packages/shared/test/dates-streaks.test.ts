import { describe, expect, it } from "vitest";
import { addDays, computeStreaks, dateRange, isValidTimeZone, localDate, startOfLocalDay, timeZoneOffsetMs } from "../src";

const days = (dates: string[], total = 100) => dates.map((date) => ({ date, total_tokens: total }));

describe("localDate", () => {
  it("buckets instants by the user's timezone", () => {
    const t = Date.parse("2026-03-04T20:00:00Z");
    expect(localDate(t, "UTC")).toBe("2026-03-04");
    expect(localDate(t, "Asia/Kolkata")).toBe("2026-03-05"); // 01:30 IST next day
    expect(localDate(t, "America/Los_Angeles")).toBe("2026-03-04");
    expect(localDate(t, "Pacific/Kiritimati")).toBe("2026-03-05"); // UTC+14
    expect(localDate(Date.parse("2026-03-04T09:00:00Z"), "Pacific/Pago_Pago")).toBe("2026-03-03"); // UTC-11
  });

  it("handles the US spring-forward day (23-hour day)", () => {
    // 2026-03-08 02:00 EST -> 03:00 EDT in America/New_York
    expect(localDate(Date.parse("2026-03-08T04:59:00Z"), "America/New_York")).toBe("2026-03-07"); // 23:59 EST
    expect(localDate(Date.parse("2026-03-08T05:00:00Z"), "America/New_York")).toBe("2026-03-08"); // 00:00 EST
    expect(localDate(Date.parse("2026-03-09T03:59:00Z"), "America/New_York")).toBe("2026-03-08"); // 23:59 EDT
    expect(localDate(Date.parse("2026-03-09T04:00:00Z"), "America/New_York")).toBe("2026-03-09");
  });

  it("handles the US fall-back day (25-hour day)", () => {
    // 2026-11-01 02:00 EDT -> 01:00 EST
    expect(localDate(Date.parse("2026-11-01T04:00:00Z"), "America/New_York")).toBe("2026-11-01"); // 00:00 EDT
    expect(localDate(Date.parse("2026-11-02T04:59:00Z"), "America/New_York")).toBe("2026-11-01"); // 23:59 EST
    expect(localDate(Date.parse("2026-11-02T05:00:00Z"), "America/New_York")).toBe("2026-11-02");
  });

  it("validates timezones", () => {
    expect(isValidTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("startOfLocalDay", () => {
  it("returns local midnight, including half-hour offsets", () => {
    expect(new Date(startOfLocalDay("2026-03-05", "Asia/Kolkata")).toISOString()).toBe("2026-03-04T18:30:00.000Z");
    expect(new Date(startOfLocalDay("2026-03-05", "UTC")).toISOString()).toBe("2026-03-05T00:00:00.000Z");
  });

  it("is correct on DST transition days", () => {
    expect(new Date(startOfLocalDay("2026-03-08", "America/New_York")).toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(new Date(startOfLocalDay("2026-03-09", "America/New_York")).toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(new Date(startOfLocalDay("2026-11-01", "America/New_York")).toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(new Date(startOfLocalDay("2026-11-02", "America/New_York")).toISOString()).toBe("2026-11-02T05:00:00.000Z");
    // Lord Howe Island shifts by 30 minutes.
    expect(new Date(startOfLocalDay("2026-04-05", "Australia/Lord_Howe")).toISOString()).toBe("2026-04-04T13:00:00.000Z");
  });

  it("handles a day whose midnight does not exist", () => {
    // Cuba springs forward at 00:00 -> 01:00 on 2026-03-08.
    const start = startOfLocalDay("2026-03-08", "America/Havana");
    expect(localDate(start, "America/Havana")).toBe("2026-03-08");
    expect(localDate(start - 1, "America/Havana")).toBe("2026-03-07");
  });

  it("reports offsets", () => {
    expect(timeZoneOffsetMs(Date.parse("2026-01-15T00:00:00Z"), "Asia/Kolkata")).toBe(5.5 * 3600_000);
    expect(timeZoneOffsetMs(Date.parse("2026-07-15T00:00:00Z"), "America/New_York")).toBe(-4 * 3600_000);
  });
});

describe("computeStreaks", () => {
  it("returns zeros for no activity", () => {
    expect(computeStreaks({ days: [], today: "2026-03-10" })).toEqual({ current: 0, longest: 0, active_days: 0, last_active: null });
  });

  it("counts a streak ending today", () => {
    const r = computeStreaks({ days: days(dateRange("2026-03-06", "2026-03-10")), today: "2026-03-10" });
    expect(r).toMatchObject({ current: 5, longest: 5, active_days: 5 });
  });

  it("keeps the streak alive when the last active day is yesterday", () => {
    const r = computeStreaks({ days: days(dateRange("2026-03-06", "2026-03-09")), today: "2026-03-10" });
    expect(r.current).toBe(4);
  });

  it("breaks the streak after a full missed day", () => {
    const r = computeStreaks({ days: days(dateRange("2026-03-01", "2026-03-08")), today: "2026-03-10" });
    expect(r.current).toBe(0);
    expect(r.longest).toBe(8);
  });

  it("finds the longest run among several", () => {
    const r = computeStreaks({
      days: days([...dateRange("2026-01-01", "2026-01-10"), ...dateRange("2026-02-01", "2026-02-03"), "2026-03-10"]),
      today: "2026-03-10",
    });
    expect(r).toMatchObject({ current: 1, longest: 10, active_days: 14 });
  });

  it("applies the active-day threshold", () => {
    const r = computeStreaks({
      days: [
        { date: "2026-03-08", total_tokens: 1000 },
        { date: "2026-03-09", total_tokens: 5 },
        { date: "2026-03-10", total_tokens: 1000 },
      ],
      today: "2026-03-10",
      minTokens: 10,
    });
    expect(r).toMatchObject({ current: 1, longest: 1, active_days: 2 });
    expect(computeStreaks({ days: [{ date: "2026-03-10", total_tokens: 0 }], today: "2026-03-10" }).active_days).toBe(0);
  });

  it("crosses month, year and leap-day boundaries", () => {
    expect(computeStreaks({ days: days(dateRange("2027-12-30", "2028-01-02")), today: "2028-01-02" }).current).toBe(4);
    expect(computeStreaks({ days: days(dateRange("2028-02-27", "2028-03-01")), today: "2028-03-01" }).current).toBe(4);
  });

  it("ignores future dates", () => {
    expect(computeStreaks({ days: days(["2026-03-10", "2026-03-11"]), today: "2026-03-10" })).toMatchObject({ current: 1, active_days: 1 });
  });

  it("is not broken by DST: one event per local evening across spring-forward", () => {
    // 23:30 local every evening around the 2026-03-08 New York DST change.
    const tz = "America/New_York";
    const instants = [
      "2026-03-06T04:30:00Z", // Mar 5 23:30 EST
      "2026-03-07T04:30:00Z", // Mar 6 23:30 EST
      "2026-03-08T04:30:00Z", // Mar 7 23:30 EST
      "2026-03-09T03:30:00Z", // Mar 8 23:30 EDT
      "2026-03-10T03:30:00Z", // Mar 9 23:30 EDT
    ];
    const dates = instants.map((i) => localDate(Date.parse(i), tz));
    expect(dates).toEqual(["2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09"]);
    expect(computeStreaks({ days: days(dates), today: "2026-03-09" }).current).toBe(5);
  });

  it("depends on the user's timezone for 'today'", () => {
    // Last activity on Mar 8 (local). At 2026-03-10T02:00Z it is still Mar 9 in LA
    // (streak alive) but already Mar 10 in Kolkata (streak broken).
    const now = Date.parse("2026-03-10T02:00:00Z");
    const d = days(dateRange("2026-03-01", "2026-03-08"));
    expect(computeStreaks({ days: d, today: localDate(now, "America/Los_Angeles") }).current).toBe(8);
    expect(computeStreaks({ days: d, today: localDate(now, "Asia/Kolkata") }).current).toBe(0);
  });

  it("handles fall-back day across a streak", () => {
    const tz = "Europe/London"; // 2026-10-25 BST -> GMT
    const dates = ["2026-10-24T23:30:00Z", "2026-10-25T23:30:00Z", "2026-10-26T23:30:00Z"].map((i) => localDate(Date.parse(i), tz));
    // 2026-10-24T23:30Z is 00:30 BST on Oct 25; after fall-back 23:30Z is 23:30 GMT.
    expect(dates).toEqual(["2026-10-25", "2026-10-25", "2026-10-26"]);
    expect(computeStreaks({ days: days(dates), today: addDays("2026-10-26", 1) }).current).toBe(2);
  });
});
