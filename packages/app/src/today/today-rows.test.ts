import { describe, expect, it } from "vitest";
import type { Measure } from "../commitment/commitment.ts";
import { recordEntry } from "../entry/record-entry.ts";
import { createTestApp, type TestApp } from "../testing/app-harness.ts";
import {
  atInstant,
  fixtureTimeZone,
  givenActiveSeason,
  localInstant,
} from "../testing/entry-fixtures.ts";
import { dayOf, PER_DAY_REACH } from "../testing/entry-measures.ts";
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

function rowsOf(view: TodayView) {
  if (view.state !== "active" && view.state !== "ended") {
    throw new Error(`no rows in state ${view.state}`);
  }
  return view.rows;
}

async function record(
  app: TestApp,
  given: Awaited<ReturnType<typeof givenActiveSeason>>,
  forDay: number,
  value: string,
  note: string | null = null,
) {
  const result = await recordEntry(atInstant(app, localInstant(dayOf(forDay))), given.andrea, {
    seasonId: given.season.id,
    commitmentId: given.andreaCommitment,
    forDate: dayOf(forDay),
    value: { kind: "quantity", value },
    note,
    clientRequestId: `req-${forDay}-${value}`,
  });
  if (!result.ok) throw new Error(`setup: recordEntry failed with ${result.error.kind}`);
  return result.value.entry;
}

describe("today rows: day rows (TD-R4, TD-R6)", () => {
  it("TD-S5: a scheduled day is open, names the habit and its grace ends tomorrow", async () => {
    const { app, given } = await setup(SATURDAY_ONLY, 2);
    const rows = rowsOf(await today(app, given.andrea));
    expect(rows).toEqual([
      {
        kind: "day",
        commitmentId: given.andreaCommitment,
        habitName: "Meditar",
        privacy: "visible",
        measure: {
          unit: "minutes",
          customLabel: null,
          precision: "decimal",
          target: { direction: "reach", minimum: "10", ideal: "30" },
          schedule: SATURDAY_ONLY.schedule,
        },
        scheduledToday: true,
        opportunity: { state: "open", graceUntil: dayOf(3) },
        entries: [],
      },
    ]);
  });

  it("an unscheduled day is not scheduledToday", async () => {
    const { app, given } = await setup(SATURDAY_ONLY, 3);
    expect(rowsOf(await today(app, given.andrea))[0]).toMatchObject({
      kind: "day",
      scheduledToday: false,
      opportunity: { state: "open", graceUntil: dayOf(4) },
    });
  });

  it("an ended season describes its last day: scheduledToday follows that day's weekday", async () => {
    // Day 27 is a Wednesday (2); day 28, the first day after the season, a Thursday (3).
    const onlyThursday: Measure = {
      ...PER_DAY_REACH,
      schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [3] } },
    };
    const onlyWednesday: Measure = {
      ...PER_DAY_REACH,
      schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [2] } },
    };
    const thursday = await setup(onlyThursday, 28);
    expect(rowsOf(await today(thursday.app, thursday.given.andrea))[0]).toMatchObject({
      scheduledToday: false,
    });
    const wednesday = await setup(onlyWednesday, 28);
    expect(rowsOf(await today(wednesday.app, wednesday.given.andrea))[0]).toMatchObject({
      scheduledToday: true,
    });
  });

  it("an entry for today makes the opportunity logged and is listed as editable", async () => {
    const { app, given } = await setup(PER_DAY_REACH, 2);
    const entry = await record(app, given, 2, "30", "felt good");
    expect(rowsOf(await today(app, given.andrea))[0]).toMatchObject({
      opportunity: { state: "logged", graceUntil: dayOf(3) },
      entries: [
        {
          entryId: entry.id,
          forDate: dayOf(2),
          value: { kind: "quantity", value: "30" },
          note: "felt good",
        },
      ],
    });
  });

  it("logged comes from an entry for today, never from a make-up slot value", async () => {
    // Saturday (day 2) is the only scheduled day; the Friday entry covers it as a make-up.
    const { app, given } = await setup(SATURDAY_ONLY, 1);
    const friday = await record(app, given, 1, "30");
    const view = await today(atInstant(app, localInstant(dayOf(2))), given.andrea);
    expect(rowsOf(view)[0]).toMatchObject({
      scheduledToday: true,
      opportunity: { state: "open", graceUntil: dayOf(3) },
      entries: [{ entryId: friday.id, forDate: dayOf(1) }],
    });
  });

  it("lists only the entries whose window is still open", async () => {
    const { app, given } = await setup(PER_DAY_REACH, 0);
    await record(app, given, 0, "30");
    const view = await today(atInstant(app, localInstant(dayOf(2))), given.andrea);
    // Day 0's window closed at the end of day 1.
    expect(rowsOf(view)[0]).toMatchObject({ entries: [] });
  });
});
