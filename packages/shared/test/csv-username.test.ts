import { describe, expect, it } from "vitest";
import { identicon, normalizeModel, parseCsv, parseCursorCsv, parseGenericCsv, validateUsername, UsageAccumulator } from "../src";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, CRLF and BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv('a\n"multi\nline"\n')).toEqual([["a"], ["multi\nline"]]);
  });
});

const CURSOR_V3 = `"Date","Cloud Agent ID","Automation ID","Kind","Model","Max Mode","Input (w/ Cache Write)","Input (w/o Cache Write)","Cache Read","Output Tokens","Total Tokens","Cost"
"2026-07-05T13:18:24.614Z","","","Included","claude-4.5-sonnet","No","6112","126","11964","450","18652","0.05"
"2026-07-05T23:50:00.000Z","","","Included","claude-4.5-sonnet","No","100","10","0","5","115","Included"
"2026-07-06T01:00:00.000Z","bc-123","","On-Demand","gpt-5","Yes","0","1,000","500","200","1700","$1.25"`;

describe("parseCursorCsv", () => {
  it("parses the current individual export by column name", () => {
    const r = parseCursorCsv(CURSOR_V3, { timeZone: "UTC" });
    expect(r.errors).toEqual([]);
    expect(r.users).toBeNull();
    expect(r.rows).toEqual([
      {
        date: "2026-07-05", source: "cursor", model: "claude-4.5-sonnet", category: "coding",
        input_tokens: 136, output_tokens: 455, cache_read_tokens: 11964, cache_write_tokens: 6212, request_count: 2, image_count: 0,
      },
      {
        date: "2026-07-06", source: "cursor", model: "gpt-5", category: "coding",
        input_tokens: 1000, output_tokens: 200, cache_read_tokens: 500, cache_write_tokens: 0, request_count: 1, image_count: 0,
      },
    ]);
  });

  it("buckets by the user's timezone", () => {
    const r = parseCursorCsv(CURSOR_V3, { timeZone: "Asia/Kolkata" });
    // 23:50Z on Jul 5 is Jul 6 in IST.
    expect(r.rows.find((x) => x.date === "2026-07-06" && x.model === "claude-4.5-sonnet")?.request_count).toBe(1);
  });

  it("parses the older v2 and v1 headers", () => {
    const v2 = `Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost
2025-09-01T10:00:00.000Z,Included,auto,No,1,2,3,4,10,0`;
    const v1 = `Date,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost,Cost to you
2025-03-01T10:00:00,gpt-4o,1,2,3,4,10,0,0`;
    expect(parseCursorCsv(v2, { timeZone: "UTC" }).rows[0]).toMatchObject({ date: "2025-09-01", cache_write_tokens: 1, input_tokens: 2 });
    expect(parseCursorCsv(v1, { timeZone: "UTC" }).rows[0]).toMatchObject({ date: "2025-03-01", output_tokens: 4 });
  });

  it("requires choosing a member for team exports and never outputs emails", () => {
    const team = `Date,User,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost
2026-07-05T10:00:00.000Z,alice@corp.com,Included,gpt-5,No,0,10,0,10,20,0
2026-07-05T10:00:00.000Z,bob@corp.com,Included,gpt-5,No,0,99,0,99,198,0`;
    const first = parseCursorCsv(team, { timeZone: "UTC" });
    expect(first.rows).toEqual([]);
    expect(first.users).toEqual(["alice@corp.com", "bob@corp.com"]);
    const mine = parseCursorCsv(team, { timeZone: "UTC", user: "alice@corp.com" });
    expect(mine.rows).toHaveLength(1);
    expect(mine.rows[0]!.input_tokens).toBe(10);
    expect(JSON.stringify(mine.rows)).not.toContain("@");
  });

  it("rejects files that are not Cursor exports", () => {
    expect(parseCursorCsv("a,b\n1,2", { timeZone: "UTC" }).errors[0]).toMatch(/Cursor/);
  });
});

describe("parseGenericCsv", () => {
  it("parses documented columns and aggregates duplicate keys", () => {
    const csv = `date,source,model,category,input_tokens,output_tokens
2026-03-01,gemini,gemini-2.5-pro,chat,10,20
2026-03-01,gemini,gemini-2.5-pro,chat,5,5
2026-03-02T23:30:00Z,gemini,Gemini 2.5 Pro,,1,1`;
    const r = parseGenericCsv(csv, { timeZone: "Asia/Tokyo" });
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ date: "2026-03-01", input_tokens: 15, output_tokens: 25 });
    expect(r.rows[1]).toMatchObject({ date: "2026-03-03", model: "gemini-2.5-pro", category: "chat" });
  });

  it("refuses files with unknown columns such as prompt text", () => {
    const csv = `date,model,input_tokens,prompt\n2026-03-01,x,1,"tell me a secret"`;
    const r = parseGenericCsv(csv, { timeZone: "UTC" });
    expect(r.rows).toEqual([]);
    expect(r.errors[0]).toContain("Unknown column(s): prompt");
  });

  it("reports missing required columns and bad values", () => {
    expect(parseGenericCsv("input_tokens\n1", { timeZone: "UTC" }).errors).toContain("Missing required column: date");
    const r = parseGenericCsv("date,model,source\nnot-a-date,x,other\n2026-01-01,x,myspace", { timeZone: "UTC" });
    expect(r.errors).toHaveLength(2);
  });
});

describe("normalizeModel / accumulator", () => {
  it("normalises names into the strict charset", () => {
    expect(normalizeModel("Claude Sonnet 4.5 (thinking)")).toBe("claude-sonnet-4.5-thinking");
    expect(normalizeModel("  GPT-4o  ")).toBe("gpt-4o");
    expect(normalizeModel("")).toBe("unknown");
    expect(normalizeModel("<synthetic>")).toBe("synthetic");
    expect(normalizeModel("a".repeat(100))).toHaveLength(64);
  });

  it("drops all-zero rows and only emits allowed fields", () => {
    const acc = new UsageAccumulator();
    acc.add({ date: "2026-01-01", source: "other", model: "x", category: "chat" });
    acc.add({ date: "2026-01-01", source: "other", model: "y", category: "chat", input_tokens: 1, ...({ prompt: "hi" } as object) });
    const rows = acc.toRows();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("prompt");
  });
});

describe("validateUsername", () => {
  it.each(["abc", "pratik_123", "a_b_c", "x".repeat(24)])("accepts %s", (u) => {
    expect(validateUsername(u).ok).toBe(true);
  });

  it("lower-cases input", () => {
    expect(validateUsername("Pratik").ok && validateUsername("Pratik")).toMatchObject({ username: "pratik" });
  });

  it.each([
    ["ab", "length"],
    ["x".repeat(25), "length"],
    ["has-dash", "charset"],
    ["emoji😀x", "charset"],
    ["admin", "reserved"],
    ["lead_erboard", "reserved"],
    ["fuck_you", "profanity"],
    ["sh1thead", "profanity"],
    ["big_dick_energy", "profanity"],
  ])("rejects %s (%s)", (u, error) => {
    const r = validateUsername(u);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(error);
  });

  it.each(["peacock", "grapefruit", "scrapers", "spicy_coder", "dickens_fan", "torpedo"])("does not flag %s", (u) => {
    expect(validateUsername(u).ok).toBe(true);
  });
});

describe("identicon", () => {
  it("is deterministic and symmetric", () => {
    const a = identicon("pratik");
    expect(identicon("PRATIK")).toEqual(a);
    expect(identicon("someone_else")).not.toEqual(a);
    for (const row of a.cells) expect(row).toEqual([...row].reverse());
  });
});
