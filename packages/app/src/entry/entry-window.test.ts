import { type Schedule, seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { checkEntryWindow, entryWindowDeadline } from "./entry-window.ts";

const PER_DAY: Schedule = {
  period: "perSession",
  frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
};
const TIMES_PER_WEEK: Schedule = {
  period: "perSession",
  frequency: { kind: "timesPerWeek", times: 3 },
};
const WEEKLY_TOTAL: Schedule = { period: "weeklyTotal" };

function check(schedule: Schedule, day: number, today: number, extension?: number) {
  return checkEntryWindow({
    schedule,
    day: seasonDay(day),
    today: seasonDay(today),
    lengthWeeks: 4,
    ...(extension === undefined ? {} : { pauseGraceExtensionDays: extension }),
  });
}

describe("checkEntryWindow", () => {
  it("rejects a future day (ER-2)", () => {
    expect(check(PER_DAY, 6, 5)).toEqual({ kind: "FutureDay" });
  });

  it("rejects a day outside the season, even when it is not in the future", () => {
    expect(check(PER_DAY, 28, 40)).toEqual({ kind: "OutsideSeason" });
    expect(check(PER_DAY, 27, 27)).toBeNull();
  });

  it("accepts a per-session day through the end of the next day and rejects after (ER-8, ER-9)", () => {
    expect(check(PER_DAY, 5, 5)).toBeNull();
    expect(check(PER_DAY, 5, 6)).toBeNull();
    expect(check(PER_DAY, 5, 7)).toEqual({ kind: "WindowClosed" });
  });

  it("keeps a week-bound window open until the week's last day plus grace (A9, B8)", () => {
    // Week 0 spans days 0..6, so its deadline is day 7.
    for (const schedule of [WEEKLY_TOTAL, TIMES_PER_WEEK]) {
      expect(check(schedule, 1, 5)).toBeNull();
      expect(check(schedule, 1, 7)).toBeNull();
      expect(check(schedule, 1, 8)).toEqual({ kind: "WindowClosed" });
      // Week 1 spans days 7..13, deadline day 14.
      expect(check(schedule, 7, 14)).toBeNull();
      expect(check(schedule, 7, 15)).toEqual({ kind: "WindowClosed" });
    }
  });

  it("extends the deadline by the pause grace extension (B7 hook)", () => {
    expect(check(PER_DAY, 5, 8, 2)).toBeNull();
    expect(check(PER_DAY, 5, 9, 2)).toEqual({ kind: "WindowClosed" });
    expect(check(WEEKLY_TOTAL, 1, 9, 2)).toBeNull();
    expect(check(WEEKLY_TOTAL, 1, 10, 2)).toEqual({ kind: "WindowClosed" });
  });
});

describe("entryWindowDeadline", () => {
  it("is the end of the next day for a day-bound opportunity", () => {
    expect(entryWindowDeadline(PER_DAY, seasonDay(5))).toBe(6);
  });

  it("is the week's last day plus grace for a week-bound opportunity", () => {
    for (const schedule of [WEEKLY_TOTAL, TIMES_PER_WEEK]) {
      expect(entryWindowDeadline(schedule, seasonDay(1))).toBe(7);
      expect(entryWindowDeadline(schedule, seasonDay(7))).toBe(14);
    }
  });

  it("adds the pause grace extension", () => {
    expect(entryWindowDeadline(PER_DAY, seasonDay(5), 2)).toBe(8);
    expect(entryWindowDeadline(WEEKLY_TOTAL, seasonDay(1), 2)).toBe(9);
  });

  it("agrees with checkEntryWindow: closed exactly the day after the deadline", () => {
    for (const schedule of [PER_DAY, WEEKLY_TOTAL, TIMES_PER_WEEK]) {
      for (const extension of [0, 3]) {
        const deadline = entryWindowDeadline(schedule, seasonDay(2), extension);
        expect(check(schedule, 2, deadline, extension)).toBeNull();
        expect(check(schedule, 2, deadline + 1, extension)).toEqual({ kind: "WindowClosed" });
      }
    }
  });
});
