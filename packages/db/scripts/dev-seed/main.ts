/**
 * LOCAL-ONLY dev seed: realistic circles and seasons for testing the PWA on a real phone.
 * `pnpm seed:season [--scenario <id>|all]`. Usage, accounts and safety: packages/db/README.md.
 */
import { execFileSync } from "node:child_process";
import {
  createCryptoRandomSource,
  createIntlTimeZone,
  createUuidV7IdGenerator,
  instant,
  timeZoneId,
} from "@pactjoy/app";
import { createPostgresUnitOfWork } from "../../src/index.ts";
import { goTrueAdminAccounts } from "./accounts.ts";
import { parseEnvLines, resolveConfig } from "./config.ts";
import { createSeedClock, noonIn, type SeedContext } from "./core.ts";
import { runScenarios, selectScenarios } from "./scenario.ts";

/** `supabase status -o env`, when the CLI is installed; never required. */
function supabaseStatus(): Record<string, string> {
  try {
    return parseEnvLines(execFileSync("supabase", ["status", "-o", "env"], { encoding: "utf8" }));
  } catch {
    return {};
  }
}

async function main(): Promise<number> {
  const scenarios = selectScenarios(process.argv.slice(2));
  if (typeof scenarios === "string") {
    console.error(scenarios);
    return 1;
  }
  const config = resolveConfig(
    process.env,
    process.env.SEED_SERVICE_ROLE_KEY ? {} : supabaseStatus(),
  );
  if (typeof config === "string") {
    console.error(config);
    return 1;
  }
  const zone = process.env.SEED_TIME_ZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeZone = createIntlTimeZone();
  const realNow = instant(Date.now());
  const today = timeZone.localDateAt(realNow, timeZoneId(zone));
  const clock = createSeedClock(realNow);
  const uow = createPostgresUnitOfWork({ url: config.databaseUrl, max: 2 });
  const seed: SeedContext = {
    app: {
      uow,
      clock,
      timeZone,
      ids: createUuidV7IdGenerator({ clock }),
      random: createCryptoRandomSource(),
    },
    zone,
    setDate: (date) => clock.set(noonIn(date, zone, timeZone)),
    log: (message) => console.log(message),
  };
  try {
    await runScenarios(seed, goTrueAdminAccounts({ ...config, fetch }), scenarios, today, () =>
      clock.set(realNow),
    );
    console.log(`Seeded ${scenarios.length} scenario(s) for ${today} (${zone}).`);
    console.log(
      "Log in with any account above: the OTP code arrives in Mailpit (http://127.0.0.1:54324).",
    );
    return 0;
  } finally {
    await uow.end();
  }
}

process.exitCode = await main();
