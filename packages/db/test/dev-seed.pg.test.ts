import {
  createCryptoRandomSource,
  createIntlTimeZone,
  createUuidV7IdGenerator,
  instant,
  myCircle,
  seasonProgress,
  userId,
} from "@pactjoy/app";
import { afterAll, describe, expect, it } from "vitest";
import type { Accounts } from "../scripts/dev-seed/accounts.ts";
import { createSeedClock, noonIn, type SeedContext } from "../scripts/dev-seed/core.ts";
import { runScenarios, SCENARIOS } from "../scripts/dev-seed/scenario.ts";
import { createPostgresUnitOfWork } from "../src/index.ts";
import { databaseUrl } from "./db.ts";

// The dev seed on the REAL Postgres adapter (the migrated test database, never the dev one):
// every scenario's use cases, clock moves and reads must work through `@pactjoy/db`.
const uow = createPostgresUnitOfWork({ url: databaseUrl(), max: 2 });
afterAll(() => uow.end());

const TODAY = "2026-10-08";
const ZONE = "America/Bogota";

describe("dev seed on Postgres", () => {
  it("seeds every scenario, twice (a rerun starts clean), and reads it back", async () => {
    const timeZone = createIntlTimeZone();
    const clock = createSeedClock(instant(Date.parse(`${TODAY}T17:00:00Z`)));
    const seed: SeedContext = {
      app: {
        uow,
        clock,
        timeZone,
        ids: createUuidV7IdGenerator({ clock }),
        random: createCryptoRandomSource(),
      },
      zone: ZONE,
      setDate: (date) => clock.set(noonIn(date, ZONE, timeZone)),
      log: () => {},
    };
    const ids = new Map<string, string>();
    const accounts: Accounts = {
      ensure: async (email) => {
        const id = ids.get(email) ?? crypto.randomUUID();
        ids.set(email, id);
        return { userId: userId(id) };
      },
    };
    const reset = () => seed.setDate(TODAY);
    await runScenarios(seed, accounts, SCENARIOS, TODAY, reset);
    await runScenarios(seed, accounts, SCENARIOS, TODAY, reset);

    reset();
    const andrea = await accounts.ensure("andrea@pactjoy.local");
    const seasonId = (await myCircle(seed.app, andrea)).season?.id;
    if (seasonId === undefined) throw new Error("expected a season");
    const progress = await seasonProgress(seed.app, andrea, { seasonId });
    expect(progress).toMatchObject({
      ok: true,
      value: { state: "active", calendar: { weekIndex: 2, dayOfWeek: 3 } },
    });
  });
});
