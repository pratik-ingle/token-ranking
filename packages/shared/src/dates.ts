/**
 * Calendar-date helpers. A "date" is always a plain `YYYY-MM-DD` string in
 * some user's local timezone. Instants are converted to local dates with Intl
 * (which handles DST); once you have a date string, arithmetic is done in UTC
 * so DST can never shift a day.
 */

const DAY_MS = 86_400_000;
const dtfCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  if (typeof timeZone !== "string" || timeZone.length === 0 || timeZone.length > 64) return false;
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(instant: number, timeZone: string): WallClock {
  const parts = formatterFor(timeZone).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function toDateString(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

/** The local calendar date of an instant in the given IANA timezone. */
export function localDate(instant: Date | number | string, timeZone: string): string {
  const ms = instant instanceof Date ? instant.getTime() : typeof instant === "string" ? Date.parse(instant) : instant;
  if (!Number.isFinite(ms)) throw new RangeError(`invalid instant: ${String(instant)}`);
  const w = wallClock(ms, timeZone);
  return toDateString(w.year, w.month, w.day);
}

/** Offset of the timezone from UTC at the given instant, in ms (e.g. +19_800_000 for IST). */
export function timeZoneOffsetMs(instant: number, timeZone: string): number {
  const w = wallClock(instant, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The instant (ms) at which the given local date starts in the timezone. DST-safe. */
export function startOfLocalDay(date: string, timeZone: string): number {
  const guess = parseDate(date);
  let result = guess - timeZoneOffsetMs(guess, timeZone);
  // Re-evaluate once: the offset at the real instant may differ around DST.
  const second = guess - timeZoneOffsetMs(result, timeZone);
  if (second !== result) result = second;
  // If midnight does not exist (DST gap at 00:00), the first instant of the
  // day is later; walk forward until the local date matches.
  while (localDate(result, timeZone) < date) result += 15 * 60_000;
  while (localDate(result - 1, timeZone) === date) result -= 15 * 60_000;
  return result;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse a `YYYY-MM-DD` string to the UTC midnight epoch ms (for arithmetic only). */
export function parseDate(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new RangeError(`invalid date: ${date}`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (formatDateUtc(ms) !== date) throw new RangeError(`invalid date: ${date}`);
  return ms;
}

export function formatDateUtc(ms: number): string {
  const d = new Date(ms);
  return toDateString(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function isDateString(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    parseDate(value);
    return true;
  } catch {
    return false;
  }
}

export function addDays(date: string, days: number): string {
  return formatDateUtc(parseDate(date) + days * DAY_MS);
}

/** b - a in whole days. */
export function diffDays(a: string, b: string): number {
  return Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
}

/** Inclusive list of dates from start to end. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const n = diffDays(start, end);
  for (let i = 0; i <= n; i++) out.push(addDays(start, i));
  return out;
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: string): number {
  return new Date(parseDate(date)).getUTCDay();
}

export function yearOf(date: string): number {
  return Number(date.slice(0, 4));
}

/** Today's date in the given timezone. */
export function todayIn(timeZone: string, now: number = Date.now()): string {
  return localDate(now, timeZone);
}
