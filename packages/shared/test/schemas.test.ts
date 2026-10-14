import { describe, expect, it } from "vitest";
import { ingestPayloadSchema, toUploadRow, usageRowSchema, USAGE_ROW_FIELDS, type UsageRow } from "../src";

const valid: UsageRow = {
  date: "2026-03-04",
  source: "claude_code",
  model: "claude-sonnet-4-5",
  category: "coding",
  input_tokens: 10,
  output_tokens: 20,
  cache_read_tokens: 30,
  cache_write_tokens: 40,
  request_count: 2,
  image_count: 0,
};

describe("usageRowSchema", () => {
  it("accepts a valid row", () => {
    expect(usageRowSchema.parse(valid)).toEqual(valid);
  });

  it("allows exactly the documented fields", () => {
    expect(Object.keys(usageRowSchema.shape).sort()).toEqual([...USAGE_ROW_FIELDS].sort());
  });

  it.each([
    ["prompt", "write me a poem"],
    ["completion", "roses are red"],
    ["email", "a@b.c"],
    ["org_id", "org-123"],
    ["project_name", "secret project"],
    ["trust_level", "verified"],
    ["cost", 1.23],
  ])("rejects an extra field %s instead of stripping it", (key, value) => {
    const res = usageRowSchema.safeParse({ ...valid, [key]: value });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res.error?.issues)).toContain("unrecognized_keys");
  });

  it("rejects free text in the model field", () => {
    expect(usageRowSchema.safeParse({ ...valid, model: "please summarise my medical records" }).success).toBe(false);
    expect(usageRowSchema.safeParse({ ...valid, model: "x".repeat(65) }).success).toBe(false);
    expect(usageRowSchema.safeParse({ ...valid, model: "GPT-4o" }).success).toBe(false);
  });

  it("rejects bad counters and dates", () => {
    expect(usageRowSchema.safeParse({ ...valid, input_tokens: -1 }).success).toBe(false);
    expect(usageRowSchema.safeParse({ ...valid, input_tokens: 1.5 }).success).toBe(false);
    expect(usageRowSchema.safeParse({ ...valid, input_tokens: "10" }).success).toBe(false);
    expect(usageRowSchema.safeParse({ ...valid, date: "2026-02-30" }).success).toBe(false);
    expect(usageRowSchema.safeParse({ ...valid, date: "2019-12-31" }).success).toBe(false);
    expect(usageRowSchema.safeParse({ ...valid, date: "2026-03-04T10:00:00Z" }).success).toBe(false);
    expect(usageRowSchema.safeParse({ ...valid, source: "chatgpt" }).success).toBe(false);
    expect(usageRowSchema.safeParse({ ...valid, category: "poetry" }).success).toBe(false);
  });

  it("requires every field", () => {
    const { image_count: _omit, ...rest } = valid;
    expect(usageRowSchema.safeParse(rest).success).toBe(false);
  });
});

describe("ingestPayloadSchema", () => {
  it("accepts a bare array", () => {
    expect(ingestPayloadSchema.parse([valid])).toHaveLength(1);
  });

  it("rejects an object wrapper, empty arrays and > 1000 rows", () => {
    expect(ingestPayloadSchema.safeParse({ rows: [valid] }).success).toBe(false);
    expect(ingestPayloadSchema.safeParse([]).success).toBe(false);
    const many = Array.from({ length: 1001 }, (_, i) => ({ ...valid, model: `m${i}` }));
    expect(ingestPayloadSchema.safeParse(many).success).toBe(false);
    expect(ingestPayloadSchema.safeParse(many.slice(0, 1000)).success).toBe(true);
  });

  it("rejects duplicate keys within a payload", () => {
    const res = ingestPayloadSchema.safeParse([valid, { ...valid, input_tokens: 1 }]);
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.message).toContain("duplicate");
  });

  it("rejects an extra field nested in any row", () => {
    expect(ingestPayloadSchema.safeParse([valid, { ...valid, model: "other", content: "hi" }]).success).toBe(false);
  });
});

describe("toUploadRow", () => {
  it("drops anything that is not an allowed field", () => {
    const withExtras = { ...valid, trust_level: "self_reported", secret: "x" } as unknown as UsageRow;
    expect(Object.keys(toUploadRow(withExtras)).sort()).toEqual([...USAGE_ROW_FIELDS].sort());
  });
});
