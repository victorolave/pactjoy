import { seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { loadEffectivePauses } from "../pause/effective-pauses.ts";
import { seasonId } from "../shared/ids.ts";
import { type PeriodSummary, periodSummary } from "./period-summary.ts";
import { givenReviewWorld, logMinutes, type ReviewWorld } from "./review-fixtures.ts";

const SEASON = seasonId("season-1");
const ANDREA = memberId("member-andrea");

const record = (world: ReviewWorld, day0: number, which: "meditar" | "leer") =>
  logMinutes(world, which, day0);

/** Period 1 of the 8-week/cadence-2 world: Meditar kept 9 of 14 days, Leer kept 1 of its 2 weeks. */
async function givenPeriodOneEntries(world: ReviewWorld) {
  for (let day = 0; day <= 8; day++) await record(world, day, "meditar");
  await record(world, 2, "leer");
}

/** The summary of weeks `first..last` as it reads on 1-based season day `readDay`. */
async function summaryOn(
  world: ReviewWorld,
  readDay: number,
  first = 1,
  last = 2,
): Promise<PeriodSummary> {
  const app = world.at(readDay);
  return app.uow.read(async (repos) => {
    const season = await repos.seasons.get(SEASON);
    const circle = season && (await repos.circles.get(season.circleId));
    if (!season || !circle || season.actualStart === null) throw new Error("no season");
    const pauses = await loadEffectivePauses(repos, {
      season,
      circle,
      now: app.clock.now(),
      timeZone: app.timeZone,
    });
    return periodSummary({
      season,
      actualStart: season.actualStart,
      memberId: ANDREA,
      habits: await repos.habits.getMany(
        season.commitments.filter((c) => c.memberId === ANDREA).map((c) => c.habitId),
      ),
      entries: await repos.entries.listBySeason(SEASON),
      pauses,
      today: seasonDay(readDay - 1),
      firstWeek: first,
      lastWeek: last,
    });
  });
}

describe("periodSummary", () => {
  it("SC-60: per commitment and in total, from the period's weeks only", async () => {
    const world = await givenReviewWorld();
    await givenPeriodOneEntries(world);
    const summary = await summaryOn(world, 16);

    expect(summary.commitments).toEqual([
      {
        commitmentId: world.meditar,
        habitName: "Meditar",
        icon: "book",
        scheduleKind: "perSession",
        kept: 9,
        counted: 14,
        consistencyPercent: 64,
        idealPercent: 64,
        points: 96,
      },
      {
        commitmentId: world.leer,
        habitName: "Leer",
        icon: "book",
        scheduleKind: "weeklyTotal",
        kept: 1,
        counted: 2,
        consistencyPercent: 50,
        idealPercent: 50,
        points: 50,
      },
    ]);
    // Pooled: 10 kept of 16 counted; points 600*9/56 + 400/8 = 146.43 of 250 potential.
    expect(summary.totals).toEqual({ consistencyPercent: 63, idealPercent: 59, points: 146 });
  });

  it("SC-62: the figures can still change inside the grace period, then they are final", async () => {
    const world = await givenReviewWorld();
    await givenPeriodOneEntries(world);
    expect((await summaryOn(world, 15)).final).toBe(false);
    expect((await summaryOn(world, 16)).final).toBe(true);
  });

  it("SC-62: an Entry logged inside the grace period changes the live figures", async () => {
    const world = await givenReviewWorld();
    await givenPeriodOneEntries(world);
    const before = await summaryOn(world, 15);
    await record(world, 13, "meditar");
    const after = await summaryOn(world, 15);
    expect(after.commitments[0]?.kept).toBe((before.commitments[0]?.kept ?? 0) + 1);
  });

  it("SC-64: a commitment paused all period has no ratios and adds nothing to the totals", async () => {
    const world = await givenReviewWorld();
    await givenPeriodOneEntries(world);
    await world.app.pauses.seed(SEASON, {
      memberId: ANDREA,
      commitmentId: world.meditar,
      requestedOn: seasonDay(0),
      startDay: seasonDay(0),
      end: { kind: "fixed", lastDay: seasonDay(13) },
      decision: { kind: "approved", decidedOn: seasonDay(0), resumedOn: null },
    });
    const summary = await summaryOn(world, 16);
    expect(summary.commitments[0]).toMatchObject({
      commitmentId: world.meditar,
      counted: 0,
      kept: 0,
      consistencyPercent: null,
      idealPercent: null,
    });
    // Only Leer is left: 1 kept of 2, 50 points of the 100 it could give in these two weeks.
    expect(summary.totals).toMatchObject({ consistencyPercent: 50, idealPercent: 50 });
  });

  it("SC-61: a later period reads only its own weeks, and the periods add up to the season's points", async () => {
    const world = await givenReviewWorld();
    await givenPeriodOneEntries(world);
    const second = await summaryOn(world, 70, 3, 4);
    expect(second.commitments[0]).toMatchObject({ kept: 0, counted: 14, points: 0 });
    const whole = await summaryOn(world, 70, 1, 8);
    const periods = await Promise.all(
      [1, 3, 5, 7].map((first) => summaryOn(world, 70, first, first + 1)),
    );
    const sum = periods.reduce((total, period) => total + period.totals.points, 0);
    // Rounded once per period, so it can differ from the rounded whole by the rounding only.
    const gap = sum > whole.totals.points ? sum - whole.totals.points : whole.totals.points - sum;
    expect(gap).toBeLessThanOrEqual(2);
  });
});
