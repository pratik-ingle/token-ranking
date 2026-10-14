import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/shared", "packages/collector", "packages/mcp", "apps/web"],
  },
});
