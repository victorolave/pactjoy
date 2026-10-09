import { describe, expect, it } from "vitest";
import { daysOfWeek, seasonDay } from "../calendar/season-calendar.ts";
import { fromInt } from "../fraction/fraction.ts";
import {
  buildDoneCommitment,
  buildDoneEntry,
  buildPauseRequest,
  buildQuantityEntry,
  buildWeeklyTotalCommitment,
} from "../test-support/builders.ts";
import { scoreMember } from "./member-score.ts";

describe("specificDays streak chronology", () => {
  it("preserves eight consecutive days across Tuesday-start weeks before a later reset", () => {
    const commitment = buildDoneCommitment("meditar", 100, {
      kind: "specificDays",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
    });
    const keptDays = [0, 1, 2, 3, 4, 5, 6, 7, 14, 15];
    const result = scoreMember({
      season: { lengthWeeks: 8, startWeekday: 1 },
      commitments: [commitment],
      entries: keptDays.map((day) => buildDoneEntry(commitment.id, day)),
      pauses: [],
      today: seasonDay(16),
    });
    // Days 8–13 break the first run; days 14–15 start the current run. Day 16 is still in grace.
    expect(result.commitments[0]?.streak).toEqual({ unit: "day", current: 2, best: 8 });
  });

  it.each(daysOfWeek)("is chronological when the season starts on weekday %i", (startWeekday) => {
    const commitment = buildDoneCommitment("daily", 100, {
      kind: "specificDays",
      weekdays: daysOfWeek,
    });
    const result = scoreMember({
      season: { lengthWeeks: 4, startWeekday },
      commitments: [commitment],
      entries: [0, 1, 2, 3, 4, 5, 6, 7, 14, 15].map((day) => buildDoneEntry(commitment.id, day)),
      pauses: [],
      today: seasonDay(16),
    });
    expect(result.commitments[0]?.streak).toEqual({ unit: "day", current: 2, best: 8 });
  });

  it("counts sparse scheduled opportunities, not intervening unscheduled calendar days", () => {
    const commitment = buildDoneCommitment("draw", 100, {
      kind: "specificDays",
      weekdays: [0, 2, 4],
    });
    const result = scoreMember({
      season: { lengthWeeks: 4, startWeekday: 2 },
      commitments: [commitment],
      entries: [0, 2, 5, 7, 12].map((day) => buildDoneEntry(commitment.id, day)),
      pauses: [],
      today: seasonDay(13),
    });
    // Four scheduled successes, then day 9 expires; Monday (day 12) starts a new run.
    expect(result.commitments[0]?.streak).toEqual({ unit: "day", current: 1, best: 4 });
  });

  it("freezes a paused opportunity within the chronological run", () => {
    const commitment = buildDoneCommitment("draw", 100, {
      kind: "specificDays",
      weekdays: [0, 2, 4],
    });
    const result = scoreMember({
      season: { lengthWeeks: 4, startWeekday: 2 },
      commitments: [commitment],
      entries: [0, 2, 5, 7, 12].map((day) => buildDoneEntry(commitment.id, day)),
      pauses: [
        buildPauseRequest(
          "draw",
          9,
          { kind: "fixed", lastDay: seasonDay(9) },
          {
            kind: "approved",
            decidedOn: seasonDay(9),
            resumedOn: null,
          },
        ),
      ],
      today: seasonDay(13),
    });
    expect(result.commitments[0]?.streak).toEqual({ unit: "day", current: 5, best: 5 });
  });

  it("does not break on an unlogged day until its inclusive grace deadline", () => {
    const commitment = buildDoneCommitment("daily", 100, {
      kind: "specificDays",
      weekdays: daysOfWeek,
    });
    const input = {
      season: { lengthWeeks: 4, startWeekday: 1 } as const,
      commitments: [commitment],
      entries: [0, 1, 2, 3, 4, 5, 6, 7].map((day) => buildDoneEntry(commitment.id, day)),
      pauses: [],
    };
    expect(scoreMember({ ...input, today: seasonDay(8) }).commitments[0]?.streak).toEqual({
      unit: "day",
      current: 8,
      best: 8,
    });
    expect(scoreMember({ ...input, today: seasonDay(9) }).commitments[0]?.streak).toEqual({
      unit: "day",
      current: 0,
      best: 8,
    });
  });
});

describe("week-bound streaks remain unchanged", () => {
  const sessions = buildDoneCommitment("sessions", 100, { kind: "timesPerWeek", times: 2 });
  const total = buildWeeklyTotalCommitment("total", 100, "minutes", {
    direction: "reach",
    minimum: fromInt(60),
    ideal: fromInt(60),
  });

  it.each([sessions, total])(
    "keeps week units, grace, resets and pause freezes for $id",
    (commitment) => {
      const entries =
        commitment.unit === "done"
          ? [0, 1, 7, 8, 14, 28, 29].map((day) => buildDoneEntry(commitment.id, day))
          : [0, 7, 14, 28].map((day) =>
              buildQuantityEntry(commitment.id, day, fromInt(day === 14 ? 30 : 60)),
            );
      const input = {
        season: { lengthWeeks: 6, startWeekday: 2 } as const,
        commitments: [commitment],
        entries,
        pauses: [
          buildPauseRequest(
            commitment.id,
            21,
            { kind: "fixed", lastDay: seasonDay(27) },
            {
              kind: "approved",
              decidedOn: seasonDay(21),
              resumedOn: null,
            },
          ),
        ],
      };
      for (const [today, current, best] of [
        [6, 0, 0],
        [7, 1, 1],
        [14, 2, 2],
        [21, 0, 2],
        [28, 0, 2],
        [34, 0, 2],
        [35, 1, 2],
      ] as const) {
        expect(scoreMember({ ...input, today: seasonDay(today) }).commitments[0]?.streak).toEqual({
          unit: "week",
          current,
          best,
        });
      }
    },
  );
});
