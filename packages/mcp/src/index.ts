import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTokenRankMcpServer } from "./server";

// stdout carries MCP protocol messages only; every diagnostic goes to stderr.
const log = (m: string) => process.stderr.write(`[tokenrank-mcp] ${m}\n`);

async function start(): Promise<void> {
  const server = createTokenRankMcpServer({ log });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("ready (stdio)");
  const shutdown = () => {
    void server.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((err: unknown) => {
  log(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
