import { describe, expect, it } from "vitest";
import type { Measure } from "../commitment/commitment.ts";
import { recordEntry } from "../entry/record-entry.ts";
import { createTestApp } from "../testing/app-harness.ts";
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

  it("a timesPerWeek session is worth the commitment over its 12 sessions", async () => {
    // 3 a week x 4 weeks = 12 -> 83.33; a full 30 min session earns 83.
    const { app, given } = await setup(TIMES_PER_WEEK, 2);
    await record(app, given, 2, quantity("30"));
    expect(running(await today(app, given.andrea)).rows[0]?.points).toEqual({
      perOpportunity: "83.33",
      earned: 83,
      limitPercents: null,
    });
  });

  it("weeklyTotal never shows points during the week: they are assigned when it closes", async () => {
    const { app, given } = await setup(WEEKLY_TOTAL, 2);
    await record(app, given, 2, quantity("30"));
    expect(running(await today(app, given.andrea)).rows[0]?.points).toEqual({
      perOpportunity: "250",
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

  it("a done row has no limit percents", async () => {
    const { app, given } = await setup(PER_DAY_REACH, 2);
    expect(running(await today(app, given.andrea)).rows[0]?.points.limitPercents).toBeNull();
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

  it("ignores a weeklyTotal row: its points arrive when the week closes", async () => {
    const { app, given } = await setup(WEEKLY_TOTAL, 2);
    await record(app, given, 2, quantity("30"));
    expect(running(await today(app, given.andrea)).summary.pointsToday).toBe(0);
  });
});
