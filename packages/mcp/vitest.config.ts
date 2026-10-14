import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Test against the collector's source (no build step needed).
    alias: { "tokenrank-collector": fileURLToPath(new URL("../collector/src/index.ts", import.meta.url)) },
  },
  test: {
    name: "mcp",
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
