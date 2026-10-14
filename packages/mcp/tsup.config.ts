import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

// The collector is consumed from source and bundled in (it is a dev dependency),
// together with the private @tokenrank/shared package. The MCP SDK and zod stay
// external runtime dependencies.
const collectorSrc = fileURLToPath(new URL("../collector/src/index.ts", import.meta.url));

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  splitting: false,
  sourcemap: false,
  noExternal: ["@tokenrank/shared", "tokenrank-collector"],
  banner: { js: "#!/usr/bin/env node" },
  esbuildOptions(options) {
    options.alias = { ...(options.alias ?? {}), "tokenrank-collector": collectorSrc };
  },
});
