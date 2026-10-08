import { fromInt } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import type { Measure } from "../commitment/commitment.ts";
import { buildCommitment, commitmentId } from "../commitment/commitment.ts";
import { recordEntry } from "../entry/record-entry.ts";
import { memberScore } from "../score/member-score.query.ts";
import { startWeekdayOf } from "../score/score-input.ts";
import { standings } from "../score/standings.query.ts";
import { circleId, habitId, seasonId, userId } from "../shared/ids.ts";
import { createTestApp, type TestApp } from "../testing/app-harness.ts";
import { circleFixture, habitFixture, memberFixture, seasonFixture } from "../testing/builders.ts";
import {
  atInstant,
  END_OF_DAY,
  fixtureTimeZone,
  givenActiveSeason,
  localInstant,
} from "../testing/entry-fixtures.ts";
import type { Instant } from "../time/instant.ts";
import { epochDay, type LocalDate, localDate, localDateOfEpochDay } from "../time/local-date.ts";
import { timeZoneId } from "../time/time-zone.port.ts";
import { today } from "./today.query.ts";

const DAY = (n: number) => localDateOfEpochDay(epochDay(localDate("2026-10-01")) + n);
const DAILY_REACH: Measure = {
  unit: "minutes",
  customLabel: null,
  precision: "decimal",
  target: { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) },
  schedule: {
    period: "perSession",
    frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
  },
};
const ANDREA = memberId("member-andrea");

async function setup(status: "pactOpen" | "active" | "closed", clockDate = DAY(0)) {
  const app = createTestApp({ now: localInstant(clockDate), timeZone: fixtureTimeZone });
  const given = await givenActiveSeason(app, DAILY_REACH, status);
  return { app, given };
}

/** A season whose pact closed late (B3): nominalStart is D0 but it began on D0+3. */
async function setupLateStart(clockDate: LocalDate, measure: Measure = DAILY_REACH) {
  const app = createTestApp({ now: localInstant(clockDate), timeZone: fixtureTimeZone });
  const andrea = memberFixture({
    id: ANDREA,
    userId: userId("user-andrea"),
    displayName: "Andrea",
  });
  const circle = circleFixture({ id: circleId("circle-1"), members: [andrea] });
  const season = seasonFixture({
    id: seasonId("season-1"),
    circleId: circle.id,
    status: "active",
    nominalStart: DAY(0),
    actualStart: DAY(3),
    lengthWeeks: 4,
    commitments: [
      buildCommitment({
        id: commitmentId("commitment-andrea"),
        memberId: andrea.id,
        habitId: habitId("habit-andrea"),
        weightPercent: 100,
        privacy: "visible",
        measure,
      }),
    ],
  });
  await app.uow.transaction(async (repos) => {
    await repos.circles.save(circle, null);
    await repos.seasons.save(season, null);
    await repos.habits.save(
      habitFixture({ id: habitId("habit-andrea"), ownerId: andrea.userId }),
      null,
    );
    return { ok: true, value: undefined };
  });
  return { app, actor: { userId: andrea.userId } };
}

describe("today: states (TD-R2, TD-R3)", () => {
  it("TD-S1: a user with no active circle gets only the state", async () => {
    const app = createTestApp();
    const view = await today(app, { userId: userId("user-nobody") });
    expect(view).toEqual({ state: "noCircle" });
  });

  it("TD-S2: a circle without any season is noSeason and carries the circle", async () => {
    const app = createTestApp();
    const andrea = memberFixture({
      id: ANDREA,
      userId: userId("user-andrea"),
      displayName: "Andrea",
    });
    const circle = circleFixture({
      id: circleId("circle-1"),
      name: "Los Pactos",
      members: [andrea],
    });
    await app.uow.transaction(async (repos) => {
      await repos.circles.save(circle, null);
      return { ok: true, value: undefined };
    });
    const view = await today(app, { userId: andrea.userId });
    expect(view).toEqual({ state: "noSeason", circle: { id: circle.id, name: "Los Pactos" } });
  });

  it("a closed latest season is treated as noSeason", async () => {
    const { app, given } = await setup("closed");
    const view = await today(app, given.andrea);
    expect(view).toEqual({
      state: "noSeason",
      circle: { id: given.circle.id, name: given.circle.name },
    });
  });

  it("TD-S3: an open pact is pactOpen with the season skeleton and no summary", async () => {
    const { app, given } = await setup("pactOpen");
    const view = await today(app, given.andrea);
    expect(view).toMatchObject({
      state: "pactOpen",
      viewerId: ANDREA,
      today: DAY(0),
      circle: { id: given.circle.id },
      season: { id: given.season.id, lengthWeeks: 4, actualStart: null },
    });
    expect(view).not.toHaveProperty("summary");
    expect(view).not.toHaveProperty("standings");
    expect(view).toMatchObject({
      myCommitments: [
        {
          id: given.andreaCommitment,
          habitName: "Meditar",
          icon: null,
          weightPercent: 100,
          maxPoints: 1000,
        },
      ],
    });
  });

  it("TD-S4: an active season starting tomorrow is notStarted", async () => {
    const { app, given } = await setup("active", localDate("2026-09-30"));
    const view = await today(app, given.andrea);
    expect(view).toMatchObject({
      state: "notStarted",
      today: "2026-09-30",
      myCommitments: [{ id: given.andreaCommitment, maxPoints: 1000 }],
    });
    expect(view).not.toHaveProperty("summary");
  });

  it.each(["pactOpen", "active"] as const)(
    "SR-R2: %s never includes other members' commitments when the caller has none",
    async (status) => {
      const { app, given } = await setup(status, localDate("2026-09-30"));
      const others = given.season.commitments.filter((c) => c.memberId !== ANDREA);
      expect(others).toHaveLength(1);
      await app.uow.transaction(async (repos) => {
        await repos.seasons.save({ ...given.season, commitments: others }, given.season.version);
        return { ok: true, value: undefined };
      });
      const view = await today(app, given.andrea);
      expect(view.state).toBe(status === "pactOpen" ? "pactOpen" : "notStarted");
      if (view.state !== "pactOpen" && view.state !== "notStarted")
        throw new Error("unexpected state");
      expect(view.myCommitments).toEqual([]);
    },
  );

  it("active: day 3 reports week 1 of 4, days left, own score and standings with names", async () => {
    const { app, given } = await setup("active", DAY(3));
    const view = await today(app, given.andrea);
    expect(view).toMatchObject({
      state: "active",
      viewerId: ANDREA,
      today: DAY(3),
      timeZone: given.season.timeZone,
      summary: { week: 1, weekCount: 4, daysLeft: 24, score: { kind: "scored", scope: "own" } },
      standings: { kind: "ranked", eligibleParticipantCount: 2 },
    });
    expect(JSON.stringify(view)).not.toContain("user-");
  });

  it("the last day is still active; the day after is ended (TD-R2 boundary)", async () => {
    const last = await setup("active", DAY(27));
    const lastView = await today(last.app, last.given.andrea);
    expect(lastView).toMatchObject({ state: "active", summary: { week: 4, daysLeft: 0 } });

    const after = await setup("active", DAY(28));
    const afterView = await today(after.app, after.given.andrea);
    expect(afterView).toMatchObject({
      state: "ended",
      today: DAY(28),
      summary: { week: 4, weekCount: 4, daysLeft: 0, score: { kind: "scored" } },
      standings: { kind: "ranked" },
    });
  });

  it("long after the season, the ended score is the score and standings queries' final score", async () => {
    const { app, given } = await setup("active", DAY(40));
    const view = await today(app, given.andrea);
    const score = await memberScore(app, given.andrea, { seasonId: given.season.id });
    const ranked = await standings(app, given.andrea, { seasonId: given.season.id });
    if (view.state !== "ended") throw new Error("expected ended");
    // Every daily opportunity has counted: none logged, so consistency is 0, not "—".
    expect(view.summary.score).toMatchObject({ points: 0, consistency: 0 });
    expect(score).toEqual({ ok: true, value: view.summary.score });
    expect(ranked).toEqual({ ok: true, value: view.standings });
  });

  it.each([
    [6, 1, 21],
    [7, 2, 20],
    [13, 2, 14],
    [14, 3, 13],
  ])("week boundary: day %i is week %i with %i days left", async (day, week, daysLeft) => {
    const { app, given } = await setup("active", DAY(day));
    expect(await today(app, given.andrea)).toMatchObject({
      state: "active",
      summary: { week, daysLeft },
    });
  });

  it("B3: today is measured from actualStart, not nominalStart", async () => {
    const before = await setupLateStart(DAY(2));
    expect(await today(before.app, before.actor)).toMatchObject({ state: "notStarted" });

    const first = await setupLateStart(DAY(3));
    expect(await today(first.app, first.actor)).toMatchObject({
      state: "active",
      summary: { week: 1, daysLeft: 27 },
    });

    const after = await setupLateStart(DAY(31));
    expect(await today(after.app, after.actor)).toMatchObject({ state: "ended" });
  });

  it("B3: the summary score weekdays are counted from actualStart", async () => {
    // Scheduled on the weekdays of season days 0 and 1; nominalStart is 3 days earlier, so
    // counting weekdays from it would move both slots (and the entry's slot) to other days.
    const onActualStartWeekday: Measure = {
      ...DAILY_REACH,
      schedule: {
        period: "perSession",
        frequency: {
          kind: "specificDays",
          weekdays: [startWeekdayOf(DAY(3)), startWeekdayOf(DAY(4))],
        },
      },
    };
    const { app, actor } = await setupLateStart(DAY(3), onActualStartWeekday);
    const recorded = await recordEntry(app, actor, {
      seasonId: seasonId("season-1"),
      commitmentId: commitmentId("commitment-andrea"),
      value: { kind: "quantity", value: "30" },
      clientRequestId: "r-late-start",
    });
    expect(recorded.ok).toBe(true);

    // Day 2: the first slot is filled, the second was missed.
    const later = atInstant(app, localInstant(DAY(5)));
    const view = await today(later, actor);
    const score = await memberScore(later, actor, { seasonId: seasonId("season-1") });
    expect(score).toMatchObject({ ok: true, value: { kind: "scored", points: 125 } });
    expect(view).toMatchObject({
      state: "active",
      summary: { score: score.ok ? score.value : null },
    });
  });

  it("an ended season stays ended long after its last day", async () => {
    const { app, given } = await setup("active", DAY(40));
    expect(await today(app, given.andrea)).toMatchObject({ state: "ended" });
  });

  it("TD-S10: today is computed in the season's time zone, not UTC", async () => {
    // 23:30 UTC on Dec 31 is 20:30 on the UTC-3 fixture clock.
    const utcInstant = localInstant(localDate("2026-12-31"), (20 * 60 + 30) * 60_000);
    const app: TestApp = createTestApp({ now: utcInstant });
    const andrea = memberFixture({
      id: ANDREA,
      userId: userId("user-andrea"),
      displayName: "Andrea",
    });
    const circle = circleFixture({ id: circleId("circle-1"), members: [andrea] });
    const season = seasonFixture({
      id: seasonId("season-1"),
      circleId: circle.id,
      timeZone: timeZoneId("Pacific/Auckland"),
      status: "active",
      nominalStart: localDate("2026-12-31"),
      actualStart: localDate("2026-12-31"),
      lengthWeeks: 4,
      commitments: [
        buildCommitment({
          id: commitmentId("commitment-andrea"),
          memberId: andrea.id,
          habitId: habitId("habit-andrea"),
          weightPercent: 100,
          privacy: "visible",
          measure: DAILY_REACH,
        }),
      ],
    });
    await app.uow.transaction(async (repos) => {
      await repos.circles.save(circle, null);
      await repos.seasons.save(season, null);
      await repos.habits.save(
        habitFixture({ id: habitId("habit-andrea"), ownerId: andrea.userId }),
        null,
      );
      return { ok: true, value: undefined };
    });
    const view = await today(app, { userId: andrea.userId });
    expect(view).toMatchObject({
      state: "active",
      today: "2027-01-01",
      timeZone: "Pacific/Auckland",
      summary: { week: 1, daysLeft: 26 },
    });
  });
});

describe("today: one real scoring day (TD-R7, SP-A19, SP-A21)", () => {
  /** Victor (timesPerWeek 3, done) logs the three sessions of the last week, days 21-23. */
  async function lastWeekLogged(clockDate: LocalDate) {
    const app = createTestApp({ now: localInstant(DAY(21)), timeZone: fixtureTimeZone });
    const given = await givenActiveSeason(app, DAILY_REACH);
    for (const day of [21, 22, 23]) {
      const logged = await recordEntry(atInstant(app, localInstant(DAY(day))), given.victor, {
        seasonId: given.season.id,
        commitmentId: given.victorCommitment,
        value: { kind: "done" },
        clientRequestId: `victor-${day}`,
      });
      expect(logged.ok).toBe(true);
    }
    return { app: atInstant(app, localInstant(clockDate)), given };
  }

  it("on the last day's grace day, Today scores the real day like the score and standings queries", async () => {
    // Day 28 is the grace deadline of the last week: its weekly sessions count from today.
    const { app, given } = await lastWeekLogged(DAY(28));

    const view = await today(app, given.victor);
    const score = await memberScore(app, given.victor, { seasonId: given.season.id });
    const ranked = await standings(app, given.victor, { seasonId: given.season.id });

    if (view.state !== "ended") throw new Error("expected ended");
    // 3 of 12 weekly sessions done: 1000 x 3/12 = 250.
    expect(view.summary.score).toMatchObject({ points: 250 });
    expect(score).toEqual({ ok: true, value: view.summary.score });
    expect(ranked).toEqual({ ok: true, value: view.standings });
  });

  it("after the season, only the calendar stays on the last day", async () => {
    const { app, given } = await lastWeekLogged(DAY(28));

    const view = await today(app, given.victor);

    expect(view).toMatchObject({
      state: "ended",
      today: DAY(28),
      summary: { week: 4, weekCount: 4, daysLeft: 0 },
    });
  });

  it("on the grace day, a last-day entry is still accepted and counts at once", async () => {
    const { app, given } = await lastWeekLogged(DAY(28));

    const logged = await recordEntry(app, given.andrea, {
      seasonId: given.season.id,
      commitmentId: given.andreaCommitment,
      value: { kind: "quantity", value: "30" },
      clientRequestId: "andrea-last-day",
      forDate: DAY(27),
    });
    const view = await today(app, given.andrea);

    expect(logged.ok).toBe(true);
    if (view.state !== "ended") throw new Error("expected ended");
    // 1 of 28 daily opportunities at full progress: 1000 / 28 = 35.71.
    expect(view.summary.score).toMatchObject({ points: 36 });
  });

  it("the day after the grace day, the last day is final", async () => {
    const { app, given } = await lastWeekLogged(DAY(29));

    const logged = await recordEntry(app, given.andrea, {
      seasonId: given.season.id,
      commitmentId: given.andreaCommitment,
      value: { kind: "quantity", value: "30" },
      clientRequestId: "andrea-too-late",
      forDate: DAY(27),
    });

    expect(logged.ok).toBe(false);
  });

  it("reads the clock once, so a read crossing midnight stays on one day", async () => {
    // The first read is the last millisecond of day 27; any later read is already day 28.
    const reads: Instant[] = [];
    const { app, given } = await lastWeekLogged(DAY(27));
    const crossing: TestApp = {
      ...app,
      clock: {
        now: () => {
          const at = reads.length === 0 ? localInstant(DAY(27), END_OF_DAY) : localInstant(DAY(28));
          reads.push(at);
          return at;
        },
      },
    };

    const view = await today(crossing, given.victor);

    expect(reads).toHaveLength(1);
    expect(view).toMatchObject({ state: "active", today: DAY(27), summary: { daysLeft: 0 } });
  });
});
