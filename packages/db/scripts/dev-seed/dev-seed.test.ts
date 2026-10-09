import type { Actor } from "@pactjoy/app";
import {
  instant,
  listMyHabits,
  memberProgress,
  myCircle,
  seasonProgress,
  userId,
  weekSummary,
} from "@pactjoy/app";
import { createTestApp } from "@pactjoy/app/testing";
import { describe, expect, it } from "vitest";
import type { Accounts } from "./accounts.ts";
import { parseEnvLines, resolveConfig } from "./config.ts";
import { createSeedClock, noonIn, type SeedContext } from "./core.ts";
import { runScenarios, SCENARIOS, selectScenarios } from "./scenario.ts";

const TODAY = "2026-10-08";
const ZONE = "America/Bogota";

/** The real use cases on the in-memory app, with the seed's movable clock. */
function harness() {
  const base = createTestApp();
  const clock = createSeedClock(instant(0));
  const app = { ...base, clock };
  const seed: SeedContext = {
    app,
    zone: ZONE,
    setDate: (date) => clock.set(noonIn(date, ZONE, base.timeZone)),
    log: () => {},
  };
  const ids = new Map<string, Actor>();
  const accounts: Accounts = {
    ensure: async (email) => {
      const actor = ids.get(email) ?? { userId: userId(`user-${email}`) };
      ids.set(email, actor);
      return actor;
    },
  };
  const run = () => runScenarios(seed, accounts, SCENARIOS, TODAY, () => seed.setDate(TODAY));
  return { app, seed, accounts, run };
}

describe("dev seed config (local only)", () => {
  it("refuses any non-local target and a missing key", () => {
    expect(
      resolveConfig({ SEED_SERVICE_ROLE_KEY: "k", SEED_SUPABASE_URL: "https://x.supabase.co" }),
    ).toMatch(/Refusing/);
    expect(
      resolveConfig({
        SEED_SERVICE_ROLE_KEY: "k",
        SEED_DATABASE_URL: "postgresql://u@db.example.com/x",
      }),
    ).toMatch(/Refusing/);
    expect(resolveConfig({})).toMatch(/service role key/);
  });

  it("fills the gaps from `supabase status -o env`", () => {
    const status = parseEnvLines(
      'API_URL="http://127.0.0.1:54321"\nSERVICE_ROLE_KEY="local-key"\n',
    );
    expect(resolveConfig({}, status)).toEqual({
      supabaseUrl: "http://127.0.0.1:54321",
      databaseUrl: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      serviceRoleKey: "local-key",
    });
  });

  it("selects one scenario or all, and rejects an unknown one", () => {
    expect(selectScenarios([])).toBe(SCENARIOS);
    expect(selectScenarios(["--scenario", "pair"])).toEqual([SCENARIOS[0]]);
    expect(selectScenarios(["--scenario", "nope"])).toMatch(/Unknown scenario/);
  });
});

describe("pair scenario (week 3 of 8)", () => {
  async function seeded() {
    const h = harness();
    await h.run();
    const andrea = await h.accounts.ensure("andrea@pactjoy.local");
    const victor = await h.accounts.ensure("victor@pactjoy.local");
    h.seed.setDate(TODAY);
    const circle = await myCircle(h.app, andrea);
    const seasonId = circle.season?.id;
    if (seasonId === undefined) throw new Error("expected a season");
    return { ...h, andrea, victor, seasonId };
  }

  it("is on day 3 of week 3, with a good week 1 and a difficult week 2", async () => {
    const { app, andrea, seasonId } = await seeded();
    const result = await seasonProgress(app, andrea, { seasonId });
    if (!result.ok || result.value.state === "notStarted") throw new Error("expected progress");
    const view = result.value;
    expect(view.calendar).toMatchObject({ weekIndex: 2, dayOfWeek: 3 });
    expect(view.season.lengthWeeks).toBe(8);
    const mine = (week: number) =>
      view.weeks[week]?.members.find((m) => m.memberId === view.viewerId)?.consistency;
    expect(mine(0)).toBe(100);
    expect(mine(1)).toBeLessThan(50);
    expect(view.standings.memberCount).toBe(2);
    expect(view.standings.hasEntries).toBe(true);
  });

  it("covers every kind of measure, a running streak and the difficult headline", async () => {
    const { app, andrea, seasonId } = await seeded();
    const result = await seasonProgress(app, andrea, { seasonId });
    if (!result.ok || result.value.state === "notStarted") throw new Error("expected progress");
    const meditar = result.value.own.commitments.find((c) => c.habit.name === "Meditar");
    // The Tuesday-start season's days 0–7 form one chronological run, before days 8–13 break it.
    expect(meditar?.streak).toEqual({ unit: "day", current: 2, best: 8 });
    expect(result.value.own.commitments.map((c) => c.habit.name)).toEqual([
      "Leer",
      "Meditar",
      "Inglés",
      "Máximo 1 café al día",
    ]);
    const week2 = await weekSummary(app, andrea, { seasonId, weekIndex: 1 });
    expect(week2).toMatchObject({ ok: true, value: { headline: "difficult" } });
  });

  it("Victor's private commitment reaches Andrea only as weight and points", async () => {
    const { app, andrea, victor, seasonId } = await seeded();
    const peer = await memberProgress(app, andrea, {
      seasonId,
      memberId: (await myCircle(app, victor)).circle?.members.find((m) => m.isYou)?.id as never,
    });
    if (!peer.ok || peer.value.state === "notStarted") throw new Error("expected peer progress");
    expect(peer.value.commitments.filter((c) => c.kind === "hidden")).toHaveLength(1);
  });

  it("a rerun starts clean: a new circle, the same habits, nothing duplicated", async () => {
    const h = harness();
    await h.run();
    const andrea = await h.accounts.ensure("andrea@pactjoy.local");
    const first = (await myCircle(h.app, andrea)).circle?.id;
    await h.run();
    const second = (await myCircle(h.app, andrea)).circle?.id;
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(await listMyHabits(h.app, andrea)).toHaveLength(4);
  });
});
