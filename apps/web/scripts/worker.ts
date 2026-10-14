import { loadEnv } from "./load-env";

loadEnv();
const { startScheduler } = await import("../src/server/scheduler");
startScheduler();
console.log("TokenRank worker running: leaderboard refresh + 6-hourly cloud sync. Ctrl+C to stop.");
setInterval(() => {}, 1 << 30);
