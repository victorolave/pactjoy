import { fromInt } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import type { Measure } from "../commitment/commitment.ts";
import { buildCommitment, commitmentId } from "../commitment/commitment.ts";
import { circleId, habitId, seasonId, userId } from "../shared/ids.ts";
import { createTestApp, type TestApp } from "../testing/app-harness.ts";
import { circleFixture, memberFixture, seasonFixture } from "../testing/builders.ts";
import { fixtureTimeZone, givenActiveSeason, localInstant } from "../testing/entry-fixtures.ts";
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
async function setupLateStart(clockDate: LocalDate) {
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
        measure: DAILY_REACH,
      }),
    ],
  });
  await app.uow.transaction(async (repos) => {
    await repos.circles.save(circle, null);
    await repos.seasons.save(season, null);
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
  });

  it("TD-S4: an active season starting tomorrow is notStarted", async () => {
    const { app, given } = await setup("active", localDate("2026-09-30"));
    const view = await today(app, given.andrea);
    expect(view).toMatchObject({ state: "notStarted", today: "2026-09-30" });
    expect(view).not.toHaveProperty("summary");
  });

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

  it("the ended score is the score of the last day", async () => {
    const last = await setup("active", DAY(27));
    const lastView = await today(last.app, last.given.andrea);
    const after = await setup("active", DAY(40));
    const afterView = await today(after.app, after.given.andrea);
    if (lastView.state !== "active" || afterView.state !== "ended") {
      throw new Error("unexpected states");
    }
    expect(afterView.summary.score).toEqual(lastView.summary.score);
    expect(afterView.standings).toEqual(lastView.standings);
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
