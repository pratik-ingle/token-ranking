import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Load apps/web/.env.local (then .env) for standalone scripts, like Next does. */
export function loadEnv(): void {
  for (const name of [".env.local", ".env"]) {
    const file = resolve(import.meta.dirname, "..", name);
    if (existsSync(file)) process.loadEnvFile(file);
  }
}
