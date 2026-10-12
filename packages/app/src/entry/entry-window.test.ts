import { type PauseRequest, type Schedule, seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { commitmentId } from "../commitment/commitment.ts";
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

const GYM = commitmentId("commitment-gym");

/** A request on `startDay` of the Commitment, with the given engine decision. */
function pause(
  startDay: number,
  decision: PauseRequest["decision"],
  end: PauseRequest["end"] = { kind: "fixed", lastDay: seasonDay(startDay) },
): PauseRequest {
  return {
    commitmentId: GYM,
    requestedOn: seasonDay(startDay),
    startDay: seasonDay(startDay),
    end,
    decision,
  };
}
const rejected = (startDay: number, decidedOn: number) =>
  pause(startDay, { kind: "rejected", decidedOn: seasonDay(decidedOn) });

function check(
  schedule: Schedule,
  day: number,
  today: number,
  pauses: readonly PauseRequest[] = [],
) {
  return checkEntryWindow({
    schedule,
    day: seasonDay(day),
    today: seasonDay(today),
    lengthWeeks: 4,
    pauses,
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

  it("EW-1: a rejection extends a covered day-bound window to the end of decidedOn + 1", () => {
    // Requested on day 5, rejected on day 7: the window runs through day 8, not day 6.
    const pauses = [rejected(5, 7)];
    expect(check(PER_DAY, 5, 8, pauses)).toBeNull();
    expect(check(PER_DAY, 5, 9, pauses)).toEqual({ kind: "WindowClosed" });
    expect(check(PER_DAY, 5, 8)).toEqual({ kind: "WindowClosed" });
  });

  it("EW-1: a rejection extends the whole week-bound window", () => {
    // Week 0 normally closes after day 7; a rejection decided on day 8 moves it to day 9.
    const pauses = [rejected(1, 8)];
    for (const schedule of [WEEKLY_TOTAL, TIMES_PER_WEEK]) {
      expect(check(schedule, 1, 9, pauses)).toBeNull();
      expect(check(schedule, 1, 10, pauses)).toEqual({ kind: "WindowClosed" });
    }
  });

  it("EW-5: an approved or pending request never extends a deadline", () => {
    const approved = pause(5, { kind: "approved", decidedOn: seasonDay(7), resumedOn: null });
    const pending = pause(5, { kind: "pending" });
    for (const pauses of [[approved], [pending]]) {
      expect(check(PER_DAY, 5, 6, pauses)).toBeNull();
      expect(check(PER_DAY, 5, 7, pauses)).toEqual({ kind: "WindowClosed" });
    }
  });

  it("a rejection that does not cover the day leaves its window alone", () => {
    expect(check(PER_DAY, 2, 4, [rejected(5, 7)])).toEqual({ kind: "WindowClosed" });
  });
});

describe("entryWindowDeadline", () => {
  it("is the end of the next day for a day-bound opportunity", () => {
    expect(entryWindowDeadline(PER_DAY, seasonDay(5), [])).toBe(6);
  });

  it("is the week's last day plus grace for a week-bound opportunity", () => {
    for (const schedule of [WEEKLY_TOTAL, TIMES_PER_WEEK]) {
      expect(entryWindowDeadline(schedule, seasonDay(1), [])).toBe(7);
      expect(entryWindowDeadline(schedule, seasonDay(7), [])).toBe(14);
    }
  });

  it("takes the rejection's extension from the engine's own entryGraceDeadline", () => {
    expect(entryWindowDeadline(PER_DAY, seasonDay(5), [rejected(5, 7)])).toBe(8);
    expect(entryWindowDeadline(WEEKLY_TOTAL, seasonDay(1), [rejected(1, 8)])).toBe(9);
  });

  it("agrees with checkEntryWindow: closed exactly the day after the deadline", () => {
    for (const schedule of [PER_DAY, WEEKLY_TOTAL, TIMES_PER_WEEK]) {
      for (const pauses of [[], [rejected(2, 5)]]) {
        const deadline = entryWindowDeadline(schedule, seasonDay(2), pauses);
        expect(check(schedule, 2, deadline, pauses)).toBeNull();
        expect(check(schedule, 2, deadline + 1, pauses)).toEqual({ kind: "WindowClosed" });
      }
    }
  });
});
