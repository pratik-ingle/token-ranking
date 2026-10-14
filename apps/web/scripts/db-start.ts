import EmbeddedPostgres from "embedded-postgres";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

/**
 * Local development Postgres without Docker or sudo: runs real PostgreSQL
 * binaries (from the embedded-postgres npm package) with data in .data/pg.
 * Keep this running in its own terminal.
 */
const dataDir = resolve(import.meta.dirname, "..", "..", "..", ".data", "pg");
const port = Number(process.env.PGPORT_DEV ?? 54329);

const server = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "tokenrank",
  password: "tokenrank",
  port,
  persistent: true,
  onLog: () => {},
  onError: (e) => console.error(String(e)),
});

const fresh = !existsSync(resolve(dataDir, "PG_VERSION"));
if (fresh) {
  mkdirSync(dataDir, { recursive: true });
  await server.initialise();
}
await server.start();

const client = new pg.Client({ connectionString: `postgres://tokenrank:tokenrank@127.0.0.1:${port}/postgres` });
await client.connect();
const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = 'tokenrank'");
if (exists.rowCount === 0) await client.query("CREATE DATABASE tokenrank");
await client.end();

console.log(`Postgres ready on postgres://tokenrank:tokenrank@127.0.0.1:${port}/tokenrank (data: ${dataDir})`);
console.log("Press Ctrl+C to stop.");

const stop = async () => {
  await server.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
