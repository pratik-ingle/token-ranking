import { defineConfig } from "tsup";

// `@tokenrank/shared` is a private workspace package, so it (and its zod
// dependency) is bundled in. Both entries share one chunk. The shebang banner
// is needed by the `cli` bin; on the library entry and the chunk it is a
// harmless hashbang comment.
export default defineConfig({
  entry: { index: "src/index.ts", cli: "src/cli.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  noExternal: ["@tokenrank/shared"],
  splitting: true,
  treeshake: true,
  clean: true,
  sourcemap: false,
  // No .d.ts: the library entry exists for tokenrank-mcp, which bundles this
  // package from source. The CLI is the published product.
  dts: false,
  banner: { js: "#!/usr/bin/env node" },
});
