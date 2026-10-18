/**
 * The local job trigger (ADR-0017): runs settle, sweep, plan and dispatch against a running API,
 * once or every N seconds. It reads the environment only (never a `.env` file):
 *
 *   JOBS_BASE_URL=http://127.0.0.1:54321/functions/v1/api API_JOBS_SECRET=... pnpm jobs:tick
 *   ... pnpm jobs:tick --watch 60
 *
 * A hosted environment uses pg_cron + pg_net or a scheduled CI job calling the same routes (see
 * ADR-0017's ops checklist); this script is the same trigger for local development.
 */
import { runTick } from "./jobs-tick-run.ts";

const baseUrl = process.env.JOBS_BASE_URL;
const secret = process.env.API_JOBS_SECRET;
if (!baseUrl || !secret) {
  console.error("Set JOBS_BASE_URL and API_JOBS_SECRET in the environment.");
  process.exit(2);
}

const watchIndex = process.argv.indexOf("--watch");
const everySeconds = watchIndex >= 0 ? Number(process.argv[watchIndex + 1] ?? 60) : null;
if (everySeconds !== null && !(Number.isInteger(everySeconds) && everySeconds >= 10)) {
  console.error("--watch takes whole seconds, at least 10.");
  process.exit(2);
}

const tick = async () => {
  const lines = await runTick({ baseUrl, secret, fetch: (url, init) => fetch(url, init) });
  console.log(`[${new Date().toISOString()}]\n  ${lines.join("\n  ")}`);
};

await tick();
if (everySeconds !== null) setInterval(tick, everySeconds * 1000);
