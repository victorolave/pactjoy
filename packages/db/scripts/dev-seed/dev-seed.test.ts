import type { Actor } from "@pactjoy/app";
import {
  approvePact,
  instant,
  listMyHabits,
  memberProgress,
  myCircle,
  myPauseRequests,
  seasonProgress,
  seasonResults,
  today,
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
    expect(selectScenarios(["--scenario", "pair-season-ended"])).toEqual([SCENARIOS[1]]);
    expect(new Set(SCENARIOS.flatMap((s) => s.accounts.map((a) => a.email))).size).toBe(
      SCENARIOS.flatMap((s) => s.accounts).length,
    );
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

  it("a rerun survives a habit graduated by manual testing: it gets a fresh habit", async () => {
    const h = harness();
    await h.run();
    const andrea = await h.accounts.ensure("andrea@pactjoy.local");
    const leer = (await listMyHabits(h.app, andrea)).find((habit) => habit.name === "Leer");
    if (!leer) throw new Error("expected the Leer habit");
    await h.app.uow.transaction(async (repos) => {
      await repos.habits.save(
        { ...leer, graduatedAt: instant(1), version: leer.version + 1 },
        leer.version,
      );
      return { ok: true as const, value: undefined };
    });
    await expect(h.run()).resolves.toBeUndefined();
    const habits = (await listMyHabits(h.app, andrea)).filter((habit) => habit.name === "Leer");
    expect(habits.map((habit) => habit.graduatedAt !== null).sort()).toEqual([false, true]);
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

describe("pair-season-ended scenarios (screens 36-38b)", () => {
  async function ended(email: string) {
    const h = harness();
    await h.run();
    const actor = await h.accounts.ensure(email);
    h.seed.setDate(TODAY);
    const seasonId = (await myCircle(h.app, actor)).season?.id;
    if (seasonId === undefined) throw new Error("expected a season");
    const results = await seasonResults(h.app, actor, { seasonId });
    if (!results.ok) throw new Error(`expected results, got ${results.error.kind}`);
    return results.value;
  }

  it("lands on E+2: results open, nobody closed, Leer integrated with an inicio-cierre journey", async () => {
    const andrea = await ended("andrea.cierre@pactjoy.local");
    expect(andrea.lengthWeeks).toBe(4);
    expect(andrea.actualStart).toBe("2026-09-09");
    expect(andrea.closingReviewDone).toBe(false);
    expect(andrea.closure).toBeNull();
    const byName = new Map(andrea.commitments.map((c) => [c.habitName, c]));
    expect(byName.get("Leer")).toMatchObject({ stage: "integrated" });
    expect(byName.get("Meditar")).toMatchObject({ stage: "developing" });
    expect(byName.get("Máximo 1 café al día")).toMatchObject({ stage: "new" });
    // The inicio -> cierre bars need the closing review, which the tester submits in the app.
    expect(byName.get("Leer")?.automaticity).toEqual({ from: null, to: null });
    expect(andrea.standings.memberCount).toBe(2);
    const victor = await ended("victor.cierre@pactjoy.local");
    expect(victor.closure).toBeNull();
    expect(victor.commitments.find((c) => c.habitName === "Diario")?.stage).toBe("integrated");
  });

  it("lands on E+8: Andrea closed, Victor did not", async () => {
    const andrea = await ended("andrea.vencida@pactjoy.local");
    expect(andrea.closingReviewDone).toBe(true);
    expect(andrea.closure?.decisions).toHaveLength(3);
    const leer = andrea.commitments.find((c) => c.habitName === "Leer");
    expect(leer?.automaticity.from).not.toBeNull();
    expect(leer?.automaticity.to).not.toBeNull();
    const victor = await ended("victor.vencida@pactjoy.local");
    expect(victor.closingReviewDone).toBe(false);
    expect(victor.closure).toBeNull();
  });
});

describe("pair-pact-open scenario (screens 8-13)", () => {
  it("leaves the pact open: Victor approved, Andrea has not, one private commitment", async () => {
    const h = harness();
    await h.run();
    const andrea = await h.accounts.ensure("andrea.pacto@pactjoy.local");
    const victor = await h.accounts.ensure("victor.pacto@pactjoy.local");
    h.seed.setDate(TODAY);
    const circle = (await myCircle(h.app, andrea)).circle;
    expect(circle?.name).toBe("Andrea y Victor (pacto)");
    const season = await h.app.uow.read((repos) =>
      circle ? repos.seasons.findLatestByCircle(circle.id) : Promise.resolve(null),
    );
    if (!season) throw new Error("expected a season");
    expect(season.status).toBe("pactOpen");
    expect(season.nominalStart).toBe("2026-10-11");
    const members = (await myCircle(h.app, victor)).circle?.members ?? [];
    const idOf = (name: string) => members.find((m) => m.displayName === name)?.id;
    expect(season.approvals.map((a) => a.memberId)).toEqual([idOf("Victor")]);
    expect(season.commitments).toHaveLength(7);
    expect(season.commitments.filter((c) => c.privacy === "private")).toHaveLength(1);
  });

  it("Andrea approving closes the pact and offers the baseline", async () => {
    const h = harness();
    await h.run();
    const andrea = await h.accounts.ensure("andrea.pacto@pactjoy.local");
    h.seed.setDate(TODAY);
    const circle = (await myCircle(h.app, andrea)).circle;
    const season = await h.app.uow.read((repos) =>
      circle ? repos.seasons.findLatestByCircle(circle.id) : Promise.resolve(null),
    );
    if (!season) throw new Error("expected a season");
    const approved = await approvePact(h.app, andrea, {
      seasonId: season.id,
      expectedPactRevision: season.pactRevision,
    });
    expect(approved).toMatchObject({ ok: true, value: { season: { status: "active" } } });
    const view = await today(h.app, andrea);
    expect(view).toMatchObject({ baselineOffer: { periodIndex: 0 } });
  });
});

describe("pair-pause scenario (screens 26-30b)", () => {
  async function paused() {
    const h = harness();
    await h.run();
    const andrea = await h.accounts.ensure("andrea.pausa@pactjoy.local");
    const victor = await h.accounts.ensure("victor.pausa@pactjoy.local");
    h.seed.setDate(TODAY);
    return { ...h, andrea, victor };
  }

  it("gives Andrea a request to answer and Victor a pending one", async () => {
    const { app, andrea, victor } = await paused();
    const forAndrea = await myPauseRequests(app, andrea);
    expect(forAndrea.awaitingMe).toHaveLength(1);
    expect(forAndrea.awaitingMe[0]?.myResponse).toBeNull();
    const forVictor = await myPauseRequests(app, victor);
    expect(forVictor.mine.map((r) => r.status)).toEqual(["pending"]);
    expect(forVictor.awaitingMe).toHaveLength(0);
  });

  it("gives Andrea two running approved pauses to resume, with the redistributed notice", async () => {
    const { app, andrea } = await paused();
    const view = await myPauseRequests(app, andrea);
    expect(view.mine.map((r) => r.status)).toEqual(["approved", "approved"]);
    expect(view.resumePreviews).toHaveLength(2);
    expect(view.redistributed).not.toBeNull();
    const { before, after } = view.redistributed?.total ?? { before: 0, after: 0 };
    expect(after).not.toBe(before);
  });

  it("flags exactly one of Andrea's pauses as ending tomorrow (30a)", async () => {
    const { app, andrea } = await paused();
    const view = await today(app, andrea);
    if (view.state !== "active") throw new Error(`expected an active day, got ${view.state}`);
    const rows = JSON.stringify(view.rows);
    expect(rows.match(/"endsTomorrow":true/g)).toHaveLength(1);
  });
});
