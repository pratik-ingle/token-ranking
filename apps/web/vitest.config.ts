import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "src") },
  },
  test: {
    name: "web",
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      SERVER_SECRET: "test-server-secret",
      MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
      APP_ORIGIN: "http://localhost:3000",
    },
  },
});
