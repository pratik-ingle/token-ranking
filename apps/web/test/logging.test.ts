import { localDate } from "@tokenrank/shared";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { errorSummary, log, scrub } from "@/server/logger";
import { resetRateLimits } from "@/server/rate-limit";
import { createIngestToken } from "@/server/tokens";
import { createTestDb, createUser } from "./helpers/db";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(async () => close());

function captureConsole() {
  const lines: string[] = [];
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    }),
  );
  return { lines, restore: () => spies.forEach((s) => s.mockRestore()) };
}

describe("logger", () => {
  it("drops non-whitelisted fields and scrubs secrets", () => {
    const cap = captureConsole();
    log.info("test_event", { route: "x", status: 200, body: "SECRET_BODY", authorization: "Bearer abc" } as never);
    log.error("oops", { error: "failed for sk-ant-admin01-abcdefghijk and tr_abcdefghijklmnop from 10.0.0.1 a@b.com" });
    cap.restore();
    const out = cap.lines.join("\n");
    expect(out).toContain("test_event");
    expect(out).not.toContain("SECRET_BODY");
    expect(out).not.toContain("Bearer abc");
    expect(out).not.toMatch(/sk-ant-admin01-abcdefghijk|tr_abcdefghijklmnop|10\.0\.0\.1|a@b\.com/);
  });

  it("summarises errors without stack traces", () => {
    const e = new Error("bad key sk-admin-1234567890");
    expect(errorSummary(e)).toBe("Error: bad key [redacted]");
    expect(scrub("Basic dXNlcjpwYXNz")).toBe("[redacted]");
  });
});

describe("request handling never logs bodies or secrets", () => {
  it("POST /api/v1/usage with secrets in body, headers and errors", async () => {
    resetRateLimits();
    const u = await createUser(db, "logcheck", { timezone: "UTC" });
    const { token } = await createIngestToken(db, u.id, "cli");
    const { POST } = await import("@/app/api/v1/usage/route");
    const date = localDate(Date.now(), "UTC");
    const secretPrompt = "PROMPT_SHOULD_NEVER_BE_LOGGED_42";
    const call = (body: string, auth = `Bearer ${token}`) =>
      POST(
        new NextRequest("http://localhost:3000/api/v1/usage", {
          method: "POST",
          headers: { authorization: auth, "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
          body,
        }),
        {} as never,
      );
    const good = JSON.stringify([{ date, source: "claude_code", model: "m", category: "coding", input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, request_count: 1, image_count: 0 }]);
    const withSecret = JSON.stringify([{ ...JSON.parse(good)[0], prompt: secretPrompt }]);

    const cap = captureConsole();
    const statuses = [
      (await call(good)).status,
      (await call(withSecret)).status,
      (await call("{not json " + secretPrompt)).status,
      (await call(good, "Bearer tr_" + "x".repeat(40))).status,
    ];
    process.env.LOG_REQUESTS = "1";
    statuses.push((await call(good)).status);
    delete process.env.LOG_REQUESTS;
    cap.restore();

    expect(statuses).toEqual([200, 400, 400, 401, 200]);
    const out = cap.lines.join("\n");
    expect(out).toContain("POST /api/v1/usage"); // the request log line exists...
    for (const forbidden of [token, secretPrompt, "203.0.113.9", "input_tokens", "tr_xxxx"]) {
      expect(out).not.toContain(forbidden); // ...but contains none of these
    }
  });
});
