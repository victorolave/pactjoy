import { seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { commitmentId } from "../commitment/commitment.ts";
import { seedPause, storedPause } from "../pause/pause-seed.ts";
import { commitmentStage } from "../review/commitment-stage.query.ts";
import { seasonId } from "../shared/ids.ts";
import { pauseRequestFixture } from "../testing/builders.ts";
import { localInstant } from "../testing/entry-fixtures.ts";
import { localDate } from "../time/local-date.ts";
import { profileSummary } from "./profile-summary.query.ts";
import {
  givenProfileWorld,
  givenReview,
  givenSeason,
  logDays,
  type ProfileWorld,
  range,
  WEEKLY,
} from "./profile-world.ts";

const OCT_1 = localDate("2026-10-01");
const START_A1 = localDate("2026-06-01");
const START_A2 = localDate("2026-07-06");
const START_A = localDate("2026-08-03");

const profile = (world: ProfileWorld, date: string, who: "andrea" | "victor" = "andrea") =>
  profileSummary(world.at(localDate(date)), who === "andrea" ? world.andrea : world.victor);

const ZERO = { kept: 0, counted: 0, percent: null, closedSeasons: 0, inProgress: false };

/** A 4-week season whose every day Andrea logged Meditar: 28 kept of 28 counted once it is over. */
async function givenPerfectMeditarSeason(
  world: ProfileWorld,
  id: string,
  start: ReturnType<typeof localDate>,
  status: "closed" | "active" = "closed",
) {
  await givenSeason(world, {
    id,
    start,
    status,
    commitments: [{ id: `${id}-meditar`, habit: "meditar" }],
  });
  await logDays(world, id, `${id}-meditar`, range(0, 27));
}

describe("profileSummary: empty worlds (P10, REQ-C6, REQ-C7, REQ-H7)", () => {
  it("SC-6: with no circle, consistency is zeros and every non-graduated habit is new and out of season", async () => {
    const world = await givenProfileWorld({ noCircle: true, graduated: ["yoga"] });

    const view = await profile(world, "2026-10-05");

    expect(view.consistency).toEqual(ZERO);
    expect(view.habits).toEqual([
      {
        habitId: "habit-meditar",
        name: "meditar",
        icon: "book",
        stage: "new",
        inCurrentSeason: false,
      },
      { habitId: "habit-leer", name: "leer", icon: "book", stage: "new", inCurrentSeason: false },
      { habitId: "habit-extra", name: "extra", icon: "book", stage: "new", inCurrentSeason: false },
    ]);
  });

  it("SC-5: a circle whose only season is pactOpen has zeros, and its habits are in the season", async () => {
    const world = await givenProfileWorld();
    await givenSeason(world, {
      id: "season-open",
      start: null,
      status: "pactOpen",
      commitments: [{ id: "c-meditar", habit: "meditar" }],
    });

    const view = await profile(world, "2026-10-05");

    expect(view.consistency).toEqual(ZERO);
    expect(view.habits.map((h) => [h.name, h.stage, h.inCurrentSeason])).toEqual([
      ["meditar", "new", true],
      ["leer", "new", false],
      ["yoga", "new", false],
      ["extra", "new", false],
    ]);
  });

  it("SC-8: a circle with an active season but none of the viewer's commitments has zeros", async () => {
    const world = await givenProfileWorld();
    await givenSeason(world, {
      id: "season-b",
      start: OCT_1,
      status: "active",
      commitments: [{ id: "c-victor", who: "victor", habit: "correr" }],
    });

    const view = await profile(world, "2026-10-20");

    expect(view.consistency).toEqual(ZERO);
    expect(view.habits.every((h) => !h.inCurrentSeason && h.stage === "new")).toBe(true);
  });
});

describe("profileSummary: consistency pooling (REQ-C1..C3)", () => {
  it("SC-1: pools kept and counted exactly across closed seasons, never averaging percents", async () => {
    const world = await givenProfileWorld();
    await givenPerfectMeditarSeason(world, "season-a1", START_A1);
    await givenSeason(world, {
      id: "season-a2",
      start: START_A2,
      status: "closed",
      commitments: [{ id: "a2-leer", habit: "leer", measure: WEEKLY }],
    });
    await logDays(world, "season-a2", "a2-leer", [2]);

    const { consistency } = await profile(world, "2026-10-05");

    // 28/28 and 1/4: pooled 29/32 = 90.6 %, whereas the mean of 100 % and 25 % would say 62.5 %.
    expect(consistency).toEqual({
      kept: 29,
      counted: 32,
      percent: 91,
      closedSeasons: 2,
      inProgress: false,
    });
  });

  it("SC-2: the season in progress is pooled in, so far, and flags inProgress", async () => {
    const world = await givenProfileWorld();
    await givenPerfectMeditarSeason(world, "season-a", START_A);
    await givenSeason(world, {
      id: "season-b",
      start: OCT_1,
      status: "active",
      commitments: [{ id: "b-meditar", habit: "meditar" }],
    });
    await logDays(world, "season-b", "b-meditar", range(0, 4));

    const { consistency } = await profile(world, "2026-10-11");

    expect(consistency).toMatchObject({ closedSeasons: 1, inProgress: true });
    expect(consistency.kept).toBe(28 + 5);
    expect(consistency.counted).toBe(28 + 10);
    expect(consistency.percent).toBe(87);
  });

  it("SC-3: a lone season in progress (21 kept of 25 counted) reads 84 %", async () => {
    const world = await givenProfileWorld();
    await givenSeason(world, {
      id: "season-b",
      start: OCT_1,
      status: "active",
      commitments: [{ id: "b-meditar", habit: "meditar" }],
    });
    await logDays(world, "season-b", "b-meditar", [
      ...range(0, 2),
      ...range(4, 7),
      ...range(9, 12),
      ...range(14, 17),
      ...range(19, 24),
    ]);

    const { consistency } = await profile(world, "2026-10-26");

    expect(consistency).toEqual({
      kept: 21,
      counted: 25,
      percent: 84,
      closedSeasons: 0,
      inProgress: true,
    });
  });

  it("SC-4: a season that ended but is not closed yet is still in progress, then flips to closed", async () => {
    const world = await givenProfileWorld();
    await givenPerfectMeditarSeason(world, "season-b", OCT_1, "active");

    const ended = (await profile(world, "2026-11-03")).consistency;
    expect(ended).toEqual({
      kept: 28,
      counted: 28,
      percent: 100,
      closedSeasons: 0,
      inProgress: true,
    });

    await world.app.uow.transaction(async (repos) => {
      const season = await repos.seasons.get(seasonId("season-b"));
      if (!season) throw new Error("fixture missing");
      await repos.seasons.save(
        { ...season, status: "closed", version: season.version + 1 },
        season.version,
      );
      return { ok: true, value: undefined };
    });

    expect((await profile(world, "2026-11-03")).consistency).toEqual({
      kept: 28,
      counted: 28,
      percent: 100,
      closedSeasons: 1,
      inProgress: false,
    });
  });
});

describe("profileSummary: one instant, per-season zone, pauses (REQ-C8, P2, P3)", () => {
  it("reads the clock once and shares that instant with every helper", async () => {
    const world = await givenProfileWorld();
    await givenPerfectMeditarSeason(world, "season-a", START_A);
    await givenPerfectMeditarSeason(world, "season-b", OCT_1, "active");
    const base = localInstant(localDate("2026-10-12"));
    let calls = 0;
    const ticking = {
      ...world.app,
      clock: {
        now: () => {
          calls += 1;
          return (base + calls * 86_400_000) as typeof base;
        },
      },
    };

    const view = await profileSummary(ticking, world.andrea);

    expect(calls).toBe(1);
    const fixed = await profileSummary(world.at(localDate("2026-10-13")), world.andrea);
    expect(view).toEqual(fixed);
  });

  it("converts 'today' in each season's own time zone", async () => {
    const offsets: Record<string, number> = {
      "Pacific/Auckland": 720,
      "America/Los_Angeles": -480,
    };
    const { createFixedOffsetTimeZone } = await import("../testing/fixed-time-zone.ts");
    const zones = {
      localDateAt: (
        at: Parameters<ReturnType<typeof createFixedOffsetTimeZone>["localDateAt"]>[0],
        zone: string,
      ) =>
        createFixedOffsetTimeZone({ offsetMinutes: offsets[zone] ?? 0 }).localDateAt(
          at,
          zone as never,
        ),
      isValidZone: () => true,
    };
    const countedIn = async (zone: string) => {
      const world = await givenProfileWorld({ timeZone: zones });
      await givenSeason(world, {
        id: "season-b",
        start: OCT_1,
        status: "active",
        timeZone: zone as never,
        commitments: [{ id: "b-meditar", habit: "meditar" }],
      });
      return (await profile(world, "2026-10-11")).consistency.counted;
    };

    // The same instant is 12 Oct 03:00 in Auckland (day index 11, 11 counted) and 11 Oct 07:00 in Los Angeles (10).
    expect(await countedIn("Pacific/Auckland")).toBe(11);
    expect(await countedIn("America/Los_Angeles")).toBe(10);
  });

  it("counts a day from the day after it, one more opportunity per day (R1 so-far cutoff)", async () => {
    const world = await givenProfileWorld();
    await givenSeason(world, {
      id: "season-b",
      start: OCT_1,
      status: "active",
      commitments: [{ id: "b-meditar", habit: "meditar" }],
    });

    const counted = async (date: string) => (await profile(world, date)).consistency.counted;

    expect(await counted("2026-10-09")).toBe(8);
    expect(await counted("2026-10-10")).toBe(9);
    expect(await counted("2026-10-11")).toBe(10);
  });

  it("an auto-approved pause (effective, never stored) makes its days neutral and the read writes nothing", async () => {
    const world = await givenProfileWorld();
    await givenSeason(world, {
      id: "season-b",
      start: OCT_1,
      status: "active",
      commitments: [{ id: "b-meditar", habit: "meditar" }],
    });
    await logDays(world, "season-b", "b-meditar", range(0, 6));
    const pause = pauseRequestFixture({
      seasonId: seasonId("season-b"),
      memberId: memberId("member-andrea"),
      requestedAt: localInstant(localDate("2026-10-06")),
      requestedOn: seasonDay(5),
      startDay: seasonDay(7),
      end: { kind: "fixed", lastDay: seasonDay(13) },
      commitments: [{ commitmentId: commitmentId("b-meditar"), resumedOn: null, resumedAt: null }],
    });
    await seedPause(world.app, pause);

    const { consistency } = await profile(world, "2026-10-21");

    expect(consistency).toMatchObject({ kept: 7, counted: 13 });
    const stored = await storedPause(world.app, pause.id);
    expect(stored).toEqual(pause);
  });
});

describe("profileSummary: scope and isolation (REQ-C5, C9, H1)", () => {
  it("SC-7: seasons of a circle the viewer left do not count", async () => {
    const world = await givenProfileWorld({ leftCircle: true });
    await givenPerfectMeditarSeason(world, "season-old", START_A1);
    await world.app.uow.transaction(async (repos) => {
      const old = await repos.seasons.get(seasonId("season-old"));
      if (!old) throw new Error("fixture missing");
      await repos.seasons.save(
        { ...old, circleId: "circle-0" as never, version: old.version + 1 },
        old.version,
      );
      return { ok: true, value: undefined };
    });
    await givenSeason(world, {
      id: "season-a2",
      start: START_A2,
      status: "closed",
      commitments: [{ id: "a2-leer", habit: "leer", measure: WEEKLY }],
    });
    await logDays(world, "season-a2", "a2-leer", [2]);

    const { consistency } = await profile(world, "2026-10-05");

    expect(consistency).toMatchObject({ kept: 1, counted: 4, closedSeasons: 1 });
  });

  it("a peer's commitments and entries do not move the viewer's figures, and are not in her habits", async () => {
    const world = await givenProfileWorld();
    await givenSeason(world, {
      id: "season-b",
      start: OCT_1,
      status: "active",
      commitments: [
        { id: "b-meditar", habit: "meditar" },
        { id: "b-victor", who: "victor", habit: "correr" },
      ],
    });
    await logDays(world, "season-b", "b-meditar", range(0, 9));
    const before = await profile(world, "2026-10-14");

    await logDays(world, "season-b", "b-victor", range(0, 12), { who: "victor" });
    const after = await profile(world, "2026-10-14");

    expect(after).toEqual(before);
    expect(after.habits.map((h) => h.habitId)).not.toContain("habit-correr");
    const victor = await profile(world, "2026-10-14", "victor");
    expect(victor.consistency.kept).toBe(13);
    expect(victor.habits.map((h) => h.habitId)).toEqual(["habit-correr"]);
  });

  it("graduated and private commitments still count, but a graduated habit leaves the list", async () => {
    const world = await givenProfileWorld({ graduated: ["leer"] });
    await givenSeason(world, {
      id: "season-b",
      start: OCT_1,
      status: "closed",
      commitments: [
        { id: "b-meditar", habit: "meditar", weight: 60 },
        { id: "b-leer", habit: "leer", weight: 40, measure: WEEKLY, privacy: "private" },
      ],
    });
    await logDays(world, "season-b", "b-meditar", range(0, 27));
    await logDays(world, "season-b", "b-leer", [2, 9, 16, 23]);

    const view = await profile(world, "2026-11-10");

    expect(view.consistency).toMatchObject({ kept: 32, counted: 32, percent: 100 });
    expect(view.habits.map((h) => h.name)).toEqual(["meditar", "yoga", "extra"]);
  });
});

const stagesOf = (view: Awaited<ReturnType<typeof profile>>) =>
  Object.fromEntries(view.habits.map((h) => [h.name, [h.stage, h.inCurrentSeason]]));

/**
 * Season A (closed, 4 weeks): Meditar and Leer, every day logged, baseline answered with 5s, so
 * both end A as integrated (4 strong weeks plus automaticity 5).
 */
async function givenIntegratedSeasonA(world: ProfileWorld, circle?: string) {
  await givenSeason(world, {
    id: "season-a",
    start: START_A,
    status: "closed",
    ...(circle ? { circle } : {}),
    commitments: [
      { id: "a-meditar", habit: "meditar", weight: 60 },
      { id: "a-leer", habit: "leer", weight: 40 },
    ],
  });
  await logDays(world, "season-a", "a-meditar", range(0, 27));
  await logDays(world, "season-a", "a-leer", range(0, 27));
  await givenReview(world, "season-a", ["a-meditar", "a-leer"], {
    kind: "baseline",
    periodIndex: 0,
  });
}

/** Season B (active from 1 Oct): Meditar only, carried over from A. */
async function givenCarriedSeasonB(world: ProfileWorld) {
  await givenSeason(world, {
    id: "season-b",
    start: OCT_1,
    status: "active",
    commitments: [{ id: "b-meditar", habit: "meditar" }],
  });
}

describe("profileSummary: habits list (REQ-H1..H8, P5..P7)", () => {
  it("SC-10: a habit only in an older season keeps that season's stage and reads out of season", async () => {
    const world = await givenProfileWorld();
    await givenIntegratedSeasonA(world);
    await givenCarriedSeasonB(world);

    const view = await profile(world, "2026-10-05");

    expect(stagesOf(view)).toMatchObject({
      leer: ["integrated", false],
      meditar: ["integrated", true],
    });
  });

  it("SC-11: a habit never committed is new and out of season", async () => {
    const world = await givenProfileWorld();
    await givenIntegratedSeasonA(world);
    await givenCarriedSeasonB(world);

    expect(stagesOf(await profile(world, "2026-10-05"))).toMatchObject({
      yoga: ["new", false],
      extra: ["new", false],
    });
  });

  it("orders the current season's habits first, in commitment order, then the rest by creation", async () => {
    const world = await givenProfileWorld();
    await givenSeason(world, {
      id: "season-b",
      start: OCT_1,
      status: "active",
      commitments: [
        { id: "b-leer", habit: "leer", weight: 50 },
        { id: "b-meditar", habit: "meditar", weight: 50 },
      ],
    });

    const view = await profile(world, "2026-10-05");

    expect(view.habits.map((h) => h.name)).toEqual(["leer", "meditar", "yoga", "extra"]);
  });

  it("never reports a graduated stage", async () => {
    const world = await givenProfileWorld({ graduated: ["meditar"] });
    await givenCarriedSeasonB(world);

    const view = await profile(world, "2026-10-05");

    expect(view.habits.map((h) => h.stage)).not.toContain("graduated");
  });
});

describe("profileSummary: stage carry-over into a new season (owner decision, Perfil only)", () => {
  it("a) keeps the previous season's stage while the current one has no completed review", async () => {
    const world = await givenProfileWorld();
    await givenIntegratedSeasonA(world);
    await givenCarriedSeasonB(world);

    expect(stagesOf(await profile(world, "2026-10-05")).meditar).toEqual(["integrated", true]);
  });

  it("b) a baseline alone in the current season does not end the carry-over", async () => {
    const world = await givenProfileWorld();
    await givenIntegratedSeasonA(world);
    await givenCarriedSeasonB(world);
    await givenReview(world, "season-b", ["b-meditar"], {
      kind: "baseline",
      periodIndex: 0,
      score: 1,
    });

    expect(stagesOf(await profile(world, "2026-10-05")).meditar).toEqual(["integrated", true]);
  });

  it("a skipped interim review does not end it either", async () => {
    const world = await givenProfileWorld();
    await givenIntegratedSeasonA(world);
    await givenCarriedSeasonB(world);
    await givenReview(world, "season-b", [], {
      kind: "baseline",
      periodIndex: 0,
      status: "skipped",
    });

    expect(stagesOf(await profile(world, "2026-10-05")).meditar).toEqual(["integrated", true]);
  });

  it("c) from the first completed interim review the current season's rules apply, and can be lower", async () => {
    const world = await givenProfileWorld();
    await givenIntegratedSeasonA(world);
    await givenCarriedSeasonB(world);
    await logDays(world, "season-b", "b-meditar", range(0, 9));
    await givenReview(world, "season-b", ["b-meditar"], {
      kind: "interim",
      periodIndex: 1,
      score: 3,
    });

    // Period 1 (days 1-14) kept 10 of 14 (71 %): developing, with automaticity 3 below the bar.
    expect(stagesOf(await profile(world, "2026-10-18")).meditar).toEqual(["developing", true]);
  });

  it("d) a completed closing review also ends it", async () => {
    const world = await givenProfileWorld();
    await givenIntegratedSeasonA(world);
    await givenCarriedSeasonB(world);
    await logDays(world, "season-b", "b-meditar", range(0, 9));
    await givenReview(world, "season-b", ["b-meditar"], {
      kind: "closing",
      periodIndex: 2,
      score: 3,
    });

    expect(stagesOf(await profile(world, "2026-10-18")).meditar).toEqual(["developing", true]);
  });

  it("e) a habit carried into a pactOpen season keeps the previous season's stage", async () => {
    const world = await givenProfileWorld();
    await givenIntegratedSeasonA(world);
    await givenSeason(world, {
      id: "season-c",
      start: null,
      status: "pactOpen",
      commitments: [{ id: "c-meditar", habit: "meditar" }],
    });

    expect(stagesOf(await profile(world, "2026-10-05")).meditar).toEqual(["integrated", true]);
  });

  it("f) with no previous season and no review the current stage applies (new)", async () => {
    const world = await givenProfileWorld();
    await givenCarriedSeasonB(world);

    expect(stagesOf(await profile(world, "2026-10-05")).meditar).toEqual(["new", true]);
  });

  it("g) a previous season in a circle the viewer left is ignored", async () => {
    const world = await givenProfileWorld({ leftCircle: true });
    await givenIntegratedSeasonA(world, "circle-0");
    await givenCarriedSeasonB(world);

    expect(stagesOf(await profile(world, "2026-10-05")).meditar).toEqual(["new", true]);
  });

  it("h) the previous season is the latest EARLIER one that had the habit, skipping seasons without it", async () => {
    const world = await givenProfileWorld();
    await givenIntegratedSeasonA(world);
    await givenSeason(world, {
      id: "season-mid",
      start: localDate("2026-09-01"),
      status: "closed",
      commitments: [{ id: "mid-yoga", habit: "yoga" }],
    });
    await givenCarriedSeasonB(world);

    const stages = stagesOf(await profile(world, "2026-10-05"));

    expect(stages.meditar).toEqual(["integrated", true]);
    expect(stages.yoga).toEqual(["new", false]);
  });

  it("i) the single-commitment stage of screen 17 is untouched: still the current season's own", async () => {
    const world = await givenProfileWorld();
    await givenIntegratedSeasonA(world);
    await givenCarriedSeasonB(world);

    const badge = await commitmentStage(world.at(localDate("2026-10-05")), world.andrea, {
      seasonId: seasonId("season-b"),
      commitmentId: commitmentId("b-meditar"),
    });

    expect(badge).toEqual({ ok: true, value: { commitmentId: "b-meditar", stage: "new" } });
  });

  it("a habit that left the current season keeps its last season's stage (no carry-over rule needed)", async () => {
    const world = await givenProfileWorld();
    await givenIntegratedSeasonA(world);
    await givenCarriedSeasonB(world);

    expect(stagesOf(await profile(world, "2026-10-05")).leer).toEqual(["integrated", false]);
  });
});

describe("profileSummary: read budget (REQ-P3)", () => {
  it("opens one read and issues only the reads the design budgets", async () => {
    const world = await givenProfileWorld();
    await givenIntegratedSeasonA(world);
    await givenCarriedSeasonB(world);
    const calls: string[] = [];
    let reads = 0;
    const spied = {
      ...world.at(localDate("2026-10-05")),
    };
    const spiedApp = {
      ...spied,
      uow: {
        ...spied.uow,
        read: <T>(work: Parameters<typeof spied.uow.read<T>>[0]) => {
          reads += 1;
          return spied.uow.read((repos) =>
            work(
              new Proxy(repos, {
                get(target, repoName) {
                  const repo = Reflect.get(target, repoName) as Record<string, unknown>;
                  return new Proxy(repo, {
                    get(inner, method) {
                      const value = Reflect.get(inner, method);
                      if (typeof value !== "function") return value;
                      return (...args: unknown[]) => {
                        calls.push(`${String(repoName)}.${String(method)}`);
                        return (value as (...a: unknown[]) => unknown).apply(inner, args);
                      };
                    },
                  });
                },
              }),
            ),
          );
        },
      },
    };

    await profileSummary(spiedApp, world.andrea);

    expect(reads).toBe(1);
    const count = (repo: string, method: string) =>
      calls.filter((c) => c === `${repo}.${method}`).length;
    expect(count("circles", "findActiveByUser")).toBe(1);
    expect(count("seasons", "listByCircle")).toBe(1);
    expect(count("habits", "listByOwner")).toBe(1);
    // Entries and pauses: once per contributing season (A and B), reused by the stages.
    expect(count("entries", "listBySeason")).toBe(2);
    expect(count("pauses", "listBySeason")).toBe(2);
    // B's completed-review check, then A's stage (habits + reviews).
    expect(count("reviews", "listMine")).toBe(2);
    expect(count("habits", "getMany")).toBe(1);
    expect(calls.length).toBe(1 + 1 + 1 + 2 + 2 + 2 + 1);
  });
});
