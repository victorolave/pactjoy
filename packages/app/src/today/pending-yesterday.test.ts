import { seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import type { Measure } from "../commitment/commitment.ts";
import { recordEntry } from "../entry/record-entry.ts";
import type { MemberPauseRequest } from "../pause/pause-request.repository.ts";
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

/** 2026-10-01 is a Thursday (weekday 3): season day 2 is a Saturday (5), day 3 a Sunday (6). */
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

function pending(view: TodayView) {
  if (view.state !== "active" && view.state !== "ended") throw new Error(`state ${view.state}`);
  return view.pendingYesterday;
}

const pause = (
  commitment: MemberPauseRequest["commitmentId"],
  startDay: number,
  lastDay: number,
  decision: MemberPauseRequest["decision"],
): MemberPauseRequest => ({
  memberId: memberId("member-andrea"),
  commitmentId: commitment,
  requestedOn: seasonDay(startDay),
  startDay: seasonDay(startDay),
  end: { kind: "fixed", lastDay: seasonDay(lastDay) },
  decision,
});

describe("pendingYesterday (design 15d)", () => {
  it("lists a day-bound opportunity of yesterday with no entry, with its date and grace end", async () => {
    // Today is day 3; yesterday, day 2, has the daily row and nothing logged.
    const { app, given } = await setup(PER_DAY_REACH, 3);
    const items = pending(await today(app, given.andrea));
    expect(items).toEqual([
      {
        commitmentId: given.andreaCommitment,
        habitName: "Meditar",
        privacy: "visible",
        measure: expect.objectContaining({ unit: "minutes" }),
        forDate: dayOf(2),
        graceUntil: dayOf(3),
        points: { perOpportunity: "35.71", earned: null, limitPercents: null },
      },
    ]);
  });

  it("includes a daily limit row, with the percent each option scores", async () => {
    const { app, given } = await setup(LIMIT, 3);
    const [item] = pending(await today(app, given.andrea));
    expect(item?.points.limitPercents).toEqual([100, 100, 100, 75, 50, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("only yesterday: the day before it is out of reach, and so is today", async () => {
    const { app, given } = await setup(PER_DAY_REACH, 5);
    const items = pending(await today(app, given.andrea));
    expect(items.map((item) => item.forDate)).toEqual([dayOf(4)]);
  });

  it("leaves it out once yesterday has an entry, a Hoy no salió included", async () => {
    const logged = await setup(PER_DAY_REACH, 3);
    await record(logged.app, logged.given, 2, { kind: "quantity", value: "30" });
    expect(pending(await today(logged.app, logged.given.andrea))).toEqual([]);
    const missed = await setup(PER_DAY_REACH, 3);
    await record(missed.app, missed.given, 2, { kind: "missed" });
    expect(pending(await today(missed.app, missed.given.andrea))).toEqual([]);
  });

  it("leaves it out when a make-up entry of the week already covers yesterday's slot (engine rule)", async () => {
    // Saturday (day 2) is the only scheduled day; the Friday entry covers it as a make-up.
    const { app, given } = await setup(SATURDAY_ONLY, 1);
    await record(app, given, 1, { kind: "quantity", value: "30" });
    const later = atInstant(app, localInstant(dayOf(3)));
    expect(pending(await today(later, given.andrea))).toEqual([]);
  });

  it("leaves it out when yesterday was not a scheduled day", async () => {
    // Today is Saturday (day 2): yesterday, Friday, is not scheduled.
    const { app, given } = await setup(SATURDAY_ONLY, 2);
    expect(pending(await today(app, given.andrea))).toEqual([]);
  });

  it("leaves it out when yesterday was paused or on hold", async () => {
    const paused = await setup(PER_DAY_REACH, 3);
    paused.app.pauses.add(
      paused.given.season.id,
      pause(paused.given.andreaCommitment, 2, 2, {
        kind: "approved",
        decidedOn: seasonDay(2),
        resumedOn: null,
      }),
    );
    expect(pending(await today(paused.app, paused.given.andrea))).toEqual([]);
    const held = await setup(PER_DAY_REACH, 3);
    held.app.pauses.add(
      held.given.season.id,
      pause(held.given.andreaCommitment, 2, 2, { kind: "pending" }),
    );
    expect(pending(await today(held.app, held.given.andrea))).toEqual([]);
  });

  it("never lists a week-bound opportunity: timesPerWeek and weeklyTotal count at week close", async () => {
    for (const measure of [TIMES_PER_WEEK, WEEKLY_TOTAL]) {
      const { app, given } = await setup(measure, 3);
      expect(pending(await today(app, given.andrea))).toEqual([]);
    }
  });

  it("has nothing on the first day: yesterday is before the season", async () => {
    const { app, given } = await setup(PER_DAY_REACH, 0);
    expect(pending(await today(app, given.andrea))).toEqual([]);
  });

  it("has nothing once the season has ended: the rows already describe its last day", async () => {
    const { app, given } = await setup(PER_DAY_REACH, 28);
    const view = await today(app, given.andrea);
    expect(view.state).toBe("ended");
    expect(pending(view)).toEqual([]);
  });
});
