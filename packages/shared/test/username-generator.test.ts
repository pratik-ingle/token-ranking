import { describe, expect, it } from "vitest";
import { generateUsername, USERNAME_ADJECTIVES, USERNAME_NOUNS, USERNAME_PATTERN, validateUsername } from "../src";

describe("generateUsername", () => {
  it("produces 1,000 names that all pass validateUsername", () => {
    const names = Array.from({ length: 1000 }, () => generateUsername());
    for (const name of names) {
      expect(validateUsername(name)).toEqual({ ok: true, username: name });
      expect(name).toMatch(USERNAME_PATTERN);
      expect(name).toMatch(/^[a-z]+_[a-z]+_\d{2}$/);
    }
    // Plenty of variety.
    expect(new Set(names).size).toBeGreaterThan(900);
  });

  it("every word combination fits in 24 characters and is clean", () => {
    for (const a of USERNAME_ADJECTIVES) {
      for (const n of USERNAME_NOUNS) {
        const name = `${a}_${n}_99`;
        expect(name.length).toBeLessThanOrEqual(24);
        expect(validateUsername(name).ok).toBe(true);
      }
    }
  });

  it("is deterministic with an injected random source", () => {
    let i = 0;
    const seq = [0, 0, 0.42];
    expect(generateUsername(() => seq[i++ % seq.length]!)).toBe("amber_otter_42");
  });
});
