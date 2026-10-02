import { seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import type { Measure } from "../commitment/commitment.ts";
import { recordEntry } from "../entry/record-entry.ts";
import type { MemberPauseRequest } from "../pause/pause-request.repository.ts";
import { createTestApp, type TestApp } from "../testing/app-harness.ts";
import {
  atInstant,
  fixtureTimeZone,
  givenActiveSeason,
  localInstant,
} from "../testing/entry-fixtures.ts";
import { dayOf, PER_DAY_REACH } from "../testing/entry-measures.ts";
import { changeSeason } from "../testing/entry-test-helpers.ts";
import { type TodayView, today } from "./today.query.ts";

const ANDREA = memberId("member-andrea");

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

function pause(
  commitment: MemberPauseRequest["commitmentId"],
  startDay: number,
  lastDay: number,
  decision: MemberPauseRequest["decision"],
): MemberPauseRequest {
  return {
    memberId: ANDREA,
    commitmentId: commitment,
    requestedOn: seasonDay(startDay),
    startDay: seasonDay(startDay),
    end: { kind: "fixed", lastDay: seasonDay(lastDay) },
    decision,
  };
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

describe("today rows: opportunity state precedence (TD-R6)", () => {
  it("TD-S7: the day after the last stays editable within grace, with the last day's deadline", async () => {
    const { app, given } = await setup(PER_DAY_REACH, 27);
    const last = await record(app, given, 27, "30");
    const view = await today(atInstant(app, localInstant(dayOf(28) /* day 28 */)), given.andrea);
    expect(view.state).toBe("ended");
    expect(rowsOf(view)[0]).toMatchObject({
      opportunity: { state: "logged", graceUntil: dayOf(28) },
      entries: [{ entryId: last.id, forDate: dayOf(27) }],
    });
  });

  it("an ended season row is open while grace allows it and no entry exists", async () => {
    const { app, given } = await setup(PER_DAY_REACH, 28);
    expect(rowsOf(await today(app, given.andrea))[0]).toMatchObject({
      opportunity: { state: "open", graceUntil: dayOf(28) },
    });
  });

  it("closed outranks logged once the window has passed", async () => {
    const { app, given } = await setup(PER_DAY_REACH, 27);
    await record(app, given, 27, "30");
    const view = await today(atInstant(app, localInstant(dayOf(29))), given.andrea);
    expect(rowsOf(view)[0]).toMatchObject({
      opportunity: { state: "closed", graceUntil: dayOf(28) },
      entries: [],
    });
  });

  it("TD-S8: an approved pause covering today is paused with no grace", async () => {
    const { app, given } = await setup(PER_DAY_REACH, 3);
    app.pauses.add(
      given.season.id,
      pause(given.andreaCommitment, 3, 5, {
        kind: "approved",
        decidedOn: seasonDay(3),
        resumedOn: null,
      }),
    );
    expect(rowsOf(await today(app, given.andrea))[0]).toMatchObject({
      opportunity: { state: "paused", graceUntil: null },
    });
  });

  it("TD-S8: a pending request covering today is onHold", async () => {
    const { app, given } = await setup(PER_DAY_REACH, 3);
    app.pauses.add(given.season.id, pause(given.andreaCommitment, 3, 5, { kind: "pending" }));
    expect(rowsOf(await today(app, given.andrea))[0]).toMatchObject({
      opportunity: { state: "onHold", graceUntil: null },
    });
  });

  it("paused outranks closed and logged", async () => {
    const { app, given } = await setup(PER_DAY_REACH, 27);
    await record(app, given, 27, "30");
    app.pauses.add(
      given.season.id,
      pause(given.andreaCommitment, 27, 27, {
        kind: "approved",
        decidedOn: seasonDay(27),
        resumedOn: null,
      }),
    );
    const view = await today(atInstant(app, localInstant(dayOf(29))), given.andrea);
    expect(rowsOf(view)[0]).toMatchObject({ opportunity: { state: "paused", graceUntil: null } });
  });
});

describe("today rows: privacy (TD-R8, TD-S9)", () => {
  async function withPrivateCommitments() {
    const { app, given } = await setup(PER_DAY_REACH, 2);
    await changeSeason(app, given.season, {
      commitments: given.season.commitments.map((c) => ({ ...c, privacy: "private" as const })),
    });
    return { app, given };
  }

  it("TD-S9: my own private commitment shows in full", async () => {
    const { app, given } = await withPrivateCommitments();
    expect(rowsOf(await today(app, given.andrea))).toEqual([
      expect.objectContaining({
        commitmentId: given.andreaCommitment,
        habitName: "Meditar",
        privacy: "private",
        measure: expect.objectContaining({
          unit: "minutes",
          target: { direction: "reach", minimum: "10", ideal: "30" },
        }),
      }),
    ]);
  });

  it("another member's private commitment, habit and note never reach my view", async () => {
    const { app, given } = await withPrivateCommitments();
    await recordEntry(app, given.victor, {
      seasonId: given.season.id,
      commitmentId: given.victorCommitment,
      forDate: dayOf(2),
      value: { kind: "done" },
      note: "secret victor note",
      clientRequestId: "victor-1",
    });
    const view = await today(app, given.andrea);
    expect(rowsOf(view)).toHaveLength(1);
    const text = JSON.stringify(view);
    expect(text).not.toContain("Leer");
    expect(text).not.toContain("habit-victor");
    expect(text).not.toContain(given.victorCommitment);
    expect(text).not.toContain("secret victor note");
    expect(view).toMatchObject({ standings: { kind: "ranked" } });
    expect(text).toContain("Victor");
  });
});
