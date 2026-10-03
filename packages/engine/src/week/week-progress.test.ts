import { describe, expect, it } from "vitest";
import type { Season } from "../calendar/season-calendar.ts";
import { seasonDay } from "../calendar/season-calendar.ts";
import type { Commitment } from "../commitment/commitment.ts";
import { fromInt } from "../fraction/fraction.ts";
import type { PauseDecision, PauseRequest } from "../pause/pause.ts";
import {
  buildDoneEntry,
  buildPauseRequest,
  buildQuantityCommitment,
  buildQuantityEntry,
  buildWeeklyTotalCommitment,
} from "../test-support/builders.ts";
import { fr } from "../test-support/fraction-literal.ts";
import { type WeekProgressInput, weekProgress } from "./week-progress.ts";

const season: Season = { lengthWeeks: 4, startWeekday: 0 };
const approved: PauseDecision = { kind: "approved", decidedOn: seasonDay(0), resumedOn: null };
const pending: PauseDecision = { kind: "pending" };
const pauseDays = (id: string, from: number, to: number, decision: PauseDecision): PauseRequest =>
  buildPauseRequest(id, from, { kind: "fixed", lastDay: seasonDay(to) }, decision);

const pagesTarget = { direction: "reach", minimum: fromInt(1), ideal: fromInt(5) } as const;
const gym = (times: number) =>
  buildQuantityCommitment(
    "gym",
    100,
    "times",
    { direction: "reach", minimum: fromInt(1), ideal: fromInt(1) },
    { kind: "timesPerWeek", times },
  );
const reading = buildWeeklyTotalCommitment("reading", 100, "minutes", {
  direction: "reach",
  minimum: fromInt(60),
  ideal: fromInt(150),
});
const study = buildQuantityCommitment("study", 100, "pages", pagesTarget, {
  kind: "specificDays",
  weekdays: [0, 2],
});

/** Week 0 of the 4-week season, `today` = day 6, unless overridden. */
function run(commitment: Commitment, over: Partial<WeekProgressInput> = {}) {
  return weekProgress({
    season,
    commitment,
    week: 0,
    entries: [],
    pauses: [],
    today: seasonDay(6),
    ...over,
  });
}

function scored(commitment: Commitment, over: Partial<WeekProgressInput> = {}) {
  const result = run(commitment, over);
  if (result.status !== "scored") throw new Error(`expected scored, got ${result.status}`);
  return result;
}

describe("weekProgress - figures (WP-S1..S3)", () => {
  it("WP-S1: timesPerWeek N=3 with 2 sessions at minimum", () => {
    const entries = [buildDoneEntry("gym", 0), buildDoneEntry("gym", 2)];
    const result = scored(gym(3), { entries });
    expect(result.sessionsDone).toBe(2);
    expect(result.sessionsTarget).toBe(3);
    expect(result.progress).toEqual(fr("2/3"));
    expect(result.value).toEqual(fromInt(2));
    expect(result.slots).toEqual([]);
  });

  it("WP-S1 triangulation: no entries gives zero progress and a null value", () => {
    const result = scored(gym(3));
    expect(result.sessionsDone).toBe(0);
    expect(result.progress).toEqual(fromInt(0));
    expect(result.value).toBeNull();
  });

  it("WP-S2: weeklyTotal ideal 150 with 90 logged", () => {
    const entries = [
      buildQuantityEntry("reading", 0, fromInt(40)),
      buildQuantityEntry("reading", 3, fromInt(50)),
    ];
    const result = scored(reading, { entries });
    expect(result.value).toEqual(fromInt(90));
    expect(result.target).toEqual({
      direction: "reach",
      minimum: fromInt(60),
      ideal: fromInt(150),
    });
    expect(result.progress).toEqual(fr("3/5"));
    expect([result.sessionsDone, result.sessionsTarget]).toEqual([1, 1]);
  });

  it("WP-S3: more sessions than N counts only the best N", () => {
    const pages = buildQuantityCommitment("pages", 100, "pages", pagesTarget, {
      kind: "timesPerWeek",
      times: 3,
    });
    const entries = [1, 2, 3, 4, 5].map((v, day) => buildQuantityEntry("pages", day, fromInt(v)));
    const result = scored(pages, { entries });
    expect([result.sessionsDone, result.sessionsTarget]).toEqual([3, 3]);
    expect(result.value).toEqual(fromInt(12));
    expect(result.progress).toEqual(fr("4/5"));
  });

  it("a logged value below the minimum is not a session done", () => {
    const entries = [buildQuantityEntry("study", 0, fromInt(0))];
    expect(scored(study, { entries }).sessionsDone).toBe(0);
  });

  it("ignores other commitments' and other weeks' entries", () => {
    const entries = [
      buildDoneEntry("gym", 0),
      buildDoneEntry("other", 1),
      buildDoneEntry("gym", 8),
    ];
    expect(scored(gym(3), { entries }).sessionsDone).toBe(1);
  });
});

describe("weekProgress - statuses (WP-S4, corrected WP-R4)", () => {
  it("an approved pause over the whole week is paused", () => {
    const result = run(gym(3), { pauses: [pauseDays("gym", 0, 6, approved)] });
    expect(result.status).toBe("paused");
    expect(result.excluded.paused).toHaveLength(7);
    expect(result.excluded.onHold).toEqual([]);
  });

  it("a pending request over the whole week is onHold", () => {
    const result = run(gym(3), { pauses: [pauseDays("gym", 0, 6, pending)] });
    expect(result.status).toBe("onHold");
    expect(result.excluded.onHold).toHaveLength(7);
  });

  it("mixed approved and pending days is onHold", () => {
    const pauses = [pauseDays("gym", 0, 3, approved), pauseDays("gym", 4, 6, pending)];
    expect(run(gym(1), { pauses }).status).toBe("onHold");
  });

  it("3 of 7 days paused stays scored with the session count prorated", () => {
    const result = scored(gym(3), { pauses: [pauseDays("gym", 0, 2, approved)] });
    expect(result.sessionsTarget).toBe(2); // 3 x 4/7 = 1.71 -> 2
    expect(result.excluded.paused).toEqual([0, 1, 2]);
  });

  it("corrected R4: N=1 with 4 paused days prorates to 0, so the week is paused", () => {
    expect(run(gym(1), { pauses: [pauseDays("gym", 0, 3, approved)] }).status).toBe("paused");
  });

  it("a pending request covering only part of a scored week stays scored", () => {
    const result = scored(gym(3), { pauses: [pauseDays("gym", 5, 5, pending)] });
    expect(result.excluded.onHold).toEqual([5]);
  });

  it("weeklyTotal prorates the effective target by active days", () => {
    const result = scored(reading, { pauses: [pauseDays("reading", 0, 2, approved)] });
    // ideal 150 x 4/7 = 85.7 -> 86; minimum 60 x 4/7 = 34.3 -> 34
    expect(result.target).toEqual({ direction: "reach", minimum: fromInt(34), ideal: fromInt(86) });
  });
});

describe("weekProgress - specificDays slots (WP-S5)", () => {
  it("returns one slot per scheduled day with its own state", () => {
    const result = scored(study, { entries: [buildQuantityEntry("study", 0, fromInt(5))] });
    expect(result.slots).toEqual([
      { day: 0, filledFrom: 0, value: fromInt(5), progress: fromInt(1), consistent: true },
      { day: 2, filledFrom: null, value: null, progress: fromInt(0), consistent: false },
    ]);
    expect([result.sessionsDone, result.sessionsTarget]).toEqual([1, 2]);
  });

  it("says which day filled a slot: an extra-day make-up fills the first free one, and only if one is free", () => {
    // study is scheduled on days 0 and 2. Day 1 (not scheduled) covers the missing day 2...
    const covered = scored(study, {
      entries: [
        buildQuantityEntry("study", 0, fromInt(5)),
        buildQuantityEntry("study", 1, fromInt(5)),
      ],
    });
    expect(covered.slots.map((slot) => slot.filledFrom)).toEqual([0, 1]);
    // ...but once both slots have their own entries, day 3 fills none.
    const full = scored(study, {
      entries: [
        buildQuantityEntry("study", 0, fromInt(5)),
        buildQuantityEntry("study", 2, fromInt(5)),
        buildQuantityEntry("study", 3, fromInt(5)),
      ],
    });
    expect(full.slots.map((slot) => slot.filledFrom)).toEqual([0, 2]);
  });

  it("drops a paused scheduled day without proration", () => {
    const result = scored(study, { pauses: [pauseDays("study", 2, 2, approved)] });
    expect(result.slots.map((slot) => slot.day)).toEqual([0]);
    expect(result.sessionsTarget).toBe(1);
    expect(result.excluded.paused).toEqual([2]);
  });

  it("every scheduled day excluded reports the exclusion status", () => {
    expect(run(study, { pauses: [pauseDays("study", 0, 2, pending)] }).status).toBe("onHold");
  });
});

describe("weekProgress - range", () => {
  it.each([-1, 4])("throws RangeError for week %i of a 4-week season", (week) => {
    expect(() => run(gym(3), { week })).toThrow(RangeError);
  });
});
