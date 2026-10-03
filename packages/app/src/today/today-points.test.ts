import { fromInt } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import type { Measure } from "../commitment/commitment.ts";
import { commitmentId } from "../commitment/commitment.ts";
import { recordEntry } from "../entry/record-entry.ts";
import { habitId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { habitFixture } from "../testing/builders.ts";
import {
  atInstant,
  fixtureTimeZone,
  givenActiveSeason,
  localInstant,
} from "../testing/entry-fixtures.ts";
import {
  dayOf,
  LIMIT,
  PER_DAY_REACH,
  TIMES_PER_WEEK,
  WEEKLY_TOTAL,
} from "../testing/entry-measures.ts";
import { type TodayView, today } from "./today.query.ts";

/** 2026-10-01 is a Thursday (weekday 3), so season day 2 is a Saturday (weekday 5). */
const SATURDAY_ONLY: Measure = {
  ...PER_DAY_REACH,
  schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [5] } },
};

async function setup(measure: Measure, day: number) {
  const app = createTestApp({ now: localInstant(dayOf(day)), timeZone: fixtureTimeZone });
  const given = await givenActiveSeason(app, measure);
  return { app, given };
}

type Given = Awaited<ReturnType<typeof givenActiveSeason>>;
type Value = { kind: "quantity"; value: string } | { kind: "missed" } | { kind: "done" };

async function record(
  app: ReturnType<typeof createTestApp>,
  given: Given,
  day: number,
  value: Value,
) {
  const result = await recordEntry(atInstant(app, localInstant(dayOf(day))), given.andrea, {
    seasonId: given.season.id,
    commitmentId: given.andreaCommitment,
    forDate: dayOf(day),
    value,
    note: null,
    clientRequestId: `req-${day}-${JSON.stringify(value)}`,
  });
  if (!result.ok) throw new Error(`setup: recordEntry failed with ${result.error.kind}`);
}

function running(view: TodayView) {
  if (view.state !== "active" && view.state !== "ended") throw new Error(`state ${view.state}`);
  return view;
}

const quantity = (value: string): Value => ({ kind: "quantity", value });

describe("today rows: points of one opportunity (server-computed)", () => {
  it("a day row says what one opportunity is worth and nothing earned before logging", async () => {
    // weight 100 -> 1000 points over 4 scheduled Saturdays: 250 each.
    const { app, given } = await setup(SATURDAY_ONLY, 2);
    expect(running(await today(app, given.andrea)).rows[0]?.points).toEqual({
      perOpportunity: "250",
      perOpportunityExact: { numerator: "250", denominator: "1" },
      earned: null,
      limitPercents: null,
    });
  });

  it("keeps the exact value, rounded only at the two-decimal display boundary", async () => {
    // 1000 / 28 daily opportunities = 35.714...
    const { app, given } = await setup(PER_DAY_REACH, 2);
    expect(running(await today(app, given.andrea)).rows[0]?.points.perOpportunity).toBe("35.71");
  });

  it("earned is the logged entry's share of that value, rounded half up for display", async () => {
    // 20 of 30 min = 2/3 of 250 = 166.67 -> 167.
    const { app, given } = await setup(SATURDAY_ONLY, 2);
    await record(app, given, 2, quantity("20"));
    expect(running(await today(app, given.andrea)).rows[0]?.points.earned).toBe(167);
  });

  it("several entries of the same day add up before scoring and cap at the ideal", async () => {
    const { app, given } = await setup(SATURDAY_ONLY, 2);
    await record(app, given, 2, quantity("25"));
    await record(app, given, 2, quantity("10"));
    expect(running(await today(app, given.andrea)).rows[0]?.points.earned).toBe(250);
  });

  it("a logged miss earns zero, below the minimum earns zero", async () => {
    const missed = await setup(SATURDAY_ONLY, 2);
    await record(missed.app, missed.given, 2, { kind: "missed" });
    expect(running(await today(missed.app, missed.given.andrea)).rows[0]?.points.earned).toBe(0);
    const low = await setup(SATURDAY_ONLY, 2);
    await record(low.app, low.given, 2, quantity("5"));
    expect(running(await today(low.app, low.given.andrea)).rows[0]?.points.earned).toBe(0);
  });

  it("a timesPerWeek session is worth the commitment over its 12 sessions, but earns nothing until its week is counted", async () => {
    // 3 a week x 4 weeks = 12 -> 83.33 each. Mid-week the session does not count yet (R1, Mechanics:
    // week-bound opportunities count at week close plus grace), exactly as the season score has it.
    const { app, given } = await setup(TIMES_PER_WEEK, 2);
    await record(app, given, 2, quantity("30"));
    const view = running(await today(app, given.andrea));
    expect(view.rows[0]?.points).toEqual({
      perOpportunity: "83.33",
      perOpportunityExact: { numerator: "250", denominator: "3" },
      earned: null,
      limitPercents: null,
    });
    expect(view.summary.pointsToday).toBe(0);
    // The row and the season card agree: the card does not include it either.
    expect(view.summary.score).toMatchObject({ points: 0 });
  });

  it("a day-bound row and the season score count the same points (they cannot disagree)", async () => {
    const { app, given } = await setup(PER_DAY_REACH, 2);
    await record(app, given, 2, quantity("30"));
    const view = running(await today(app, given.andrea));
    expect(view.rows[0]?.points.earned).toBe(36);
    expect(view.summary.pointsToday).toBe(36);
    expect(view.summary.score).toMatchObject({ points: 36 });
  });

  it("the day's points leave out a week-bound row but keep a day-bound one", async () => {
    const day = await setup(PER_DAY_REACH, 2);
    await record(day.app, day.given, 2, quantity("30"));
    expect(running(await today(day.app, day.given.andrea)).summary.pointsToday).toBe(36);
    const week = await setup(TIMES_PER_WEEK, 2);
    await record(week.app, week.given, 2, quantity("30"));
    expect(running(await today(week.app, week.given.andrea)).summary.pointsToday).toBe(0);
  });

  it("weeklyTotal never shows points during the week: they are assigned when it closes", async () => {
    const { app, given } = await setup(WEEKLY_TOTAL, 2);
    await record(app, given, 2, quantity("30"));
    expect(running(await today(app, given.andrea)).rows[0]?.points).toEqual({
      perOpportunity: "250",
      perOpportunityExact: { numerator: "250", denominator: "1" },
      earned: null,
      limitPercents: null,
    });
  });

  it("a limit row carries the percent every whole-number option scores (0 to 12)", async () => {
    const { app, given } = await setup(LIMIT, 2);
    const percents = running(await today(app, given.andrea)).rows[0]?.points.limitPercents;
    // ideal 2, tolerance 4: 100 100 100, 75, 50, then past tolerance.
    expect(percents).toEqual([100, 100, 100, 75, 50, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("a limit whose tolerance outgrows the table publishes none, never one that stops short", async () => {
    const limit = (ideal: number, tolerance: number): Measure => ({
      unit: "times",
      customLabel: null,
      precision: "integer",
      target: { direction: "limit", ideal: fromInt(ideal), tolerance: fromInt(tolerance) },
      schedule: PER_DAY_REACH.schedule,
    });
    const wide = limit(14, 20);
    const { app, given } = await setup(wide, 2);
    expect(running(await today(app, given.andrea)).rows[0]?.points.limitPercents).toBeNull();
    // 11 + 1 options still fit the table.
    const fits = limit(2, 11);
    const narrow = await setup(fits, 2);
    expect(
      running(await today(narrow.app, narrow.given.andrea)).rows[0]?.points.limitPercents,
    ).toHaveLength(13);
  });

  it("a done row has no limit percents", async () => {
    const { app, given } = await setup(PER_DAY_REACH, 2);
    expect(running(await today(app, given.andrea)).rows[0]?.points.limitPercents).toBeNull();
  });
});

describe("earned follows what the engine assigned (make-up entries), not every entry of the day", () => {
  /** Viewing day `day` with whatever entries exist: the row's earned and the day's points. */
  async function viewAt(app: ReturnType<typeof createTestApp>, given: Given, day: number) {
    const view = running(await today(atInstant(app, localInstant(dayOf(day))), given.andrea));
    return { earned: view.rows[0]?.points.earned, pointsToday: view.summary.pointsToday, view };
  }

  it("an extra-day entry with no slot left earns nothing, as the season score has it (review B-C1)", async () => {
    // Saturday (day 2) is the only scheduled day: log it, then Sunday (day 3) too.
    const { app, given } = await setup(SATURDAY_ONLY, 3);
    await record(app, given, 2, quantity("30"));
    await record(app, given, 3, quantity("30"));
    const sunday = await viewAt(app, given, 3);
    expect(sunday.earned).toBe(0);
    expect(sunday.pointsToday).toBe(0);
    // The season card agrees: it holds the 250 of Saturday only.
    expect(sunday.view.summary.score).toMatchObject({ points: 250 });
    const saturday = await viewAt(app, given, 2);
    expect(saturday.earned).toBe(250);
  });

  it("an extra-day entry covering a missed scheduled day earns that slot's points", async () => {
    // Saturday missed, Sunday 30 min covers it (D5).
    const { app, given } = await setup(SATURDAY_ONLY, 3);
    await record(app, given, 3, quantity("30"));
    const sunday = await viewAt(app, given, 3);
    expect(sunday.earned).toBe(250);
    expect(sunday.pointsToday).toBe(250);
    expect(sunday.view.summary.score).toMatchObject({ points: 250 });
  });

  it("the row points of every day add up to the season points (property over entry patterns)", async () => {
    const patterns: readonly (readonly [number, string][])[] = [
      [[2, "30"]],
      [[3, "30"]],
      [
        [2, "30"],
        [3, "30"],
      ],
      [
        [1, "30"],
        [3, "15"],
      ],
      [
        [2, "10"],
        [4, "30"],
        [5, "20"],
      ],
      [
        [2, "5"],
        [3, "30"],
      ],
      [
        [0, "30"],
        [1, "30"],
        [2, "30"],
        [3, "30"],
      ],
      [
        [2, "30"],
        [9, "30"],
        [10, "15"],
      ],
    ];
    for (const pattern of patterns) {
      const { app, given } = await setup(SATURDAY_ONLY, 11);
      for (const [day, value] of pattern) await record(app, given, day, quantity(value));
      let sum = 0;
      for (let day = 0; day <= 11; day += 1) sum += (await viewAt(app, given, day)).earned ?? 0;
      const final = await viewAt(app, given, 11);
      const score = final.view.summary.score;
      expect(score.kind).toBe("scored");
      if (score.kind === "scored") expect(sum).toBe(score.points);
    }
  });
});

describe("today summary: points earned today", () => {
  it("is zero with nothing logged", async () => {
    const { app, given } = await setup(PER_DAY_REACH, 2);
    expect(running(await today(app, given.andrea)).summary.pointsToday).toBe(0);
  });

  it("adds the exact points of today's entries, then rounds once", async () => {
    // 30 min on a daily row: 1000 / 28 = 35.71 -> 36.
    const { app, given } = await setup(PER_DAY_REACH, 2);
    await record(app, given, 2, quantity("30"));
    expect(running(await today(app, given.andrea)).summary.pointsToday).toBe(36);
  });

  it("rounds once over several commitments: two half-point parts add up to 25, not 13 + 13", async () => {
    // Two commitments of weight 5 on 4 Saturdays: each slot is worth 12.5. Today's 25 is exact; summing
    // the rounded rows would say 26.
    const { app, given } = await setup(SATURDAY_ONLY, 2);
    await app.uow.transaction(async (repos) => {
      const season = await repos.seasons.findLatestByCircle(given.season.circleId);
      if (season === null) throw new Error("setup: no season");
      const first = season.commitments[0];
      if (first === undefined) throw new Error("setup: no commitment");
      const second = {
        ...first,
        id: commitmentId("commitment-andrea-2"),
        habitId: habitId("habit-andrea-2"),
      };
      const light = (c: typeof first) => ({ ...c, weightPercent: 5 });
      await repos.seasons.save(
        { ...season, commitments: [light(first), light(second), ...season.commitments.slice(1)] },
        season.version,
      );
      await repos.habits.save(
        habitFixture({ id: habitId("habit-andrea-2"), ownerId: given.andrea.userId, name: "Leer" }),
        null,
      );
      return { ok: true, value: undefined };
    });
    for (const id of [given.andreaCommitment, commitmentId("commitment-andrea-2")]) {
      const result = await recordEntry(atInstant(app, localInstant(dayOf(2))), given.andrea, {
        seasonId: given.season.id,
        commitmentId: id,
        forDate: dayOf(2),
        value: { kind: "quantity", value: "30" },
        note: null,
        clientRequestId: `req-${id}`,
      });
      if (!result.ok) throw new Error(`setup: ${result.error.kind}`);
    }
    const view = running(await today(app, given.andrea));
    expect(view.rows.map((row) => row.points.earned)).toEqual([13, 13]);
    expect(view.summary.pointsToday).toBe(25);
  });

  it("ignores a weeklyTotal row: its points arrive when the week closes", async () => {
    const { app, given } = await setup(WEEKLY_TOTAL, 2);
    await record(app, given, 2, quantity("30"));
    expect(running(await today(app, given.andrea)).summary.pointsToday).toBe(0);
  });
});
