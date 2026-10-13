import { describe, expect, it } from "vitest";
import { eConsistencyRows } from "../acceptance/rows/e-pause.rows.ts";
import { fMidSeasonRows } from "../acceptance/rows/f-full-season.rows.ts";
import { nStreakRows } from "../acceptance/rows/n-frequency.rows.ts";
import { participantFullSeasonInput } from "../acceptance/rows/participant-full-season.rows.ts";
import type { Season } from "../calendar/season-calendar.ts";
import { seasonDay } from "../calendar/season-calendar.ts";
import type { Entry } from "../entry/entry.ts";
import { div, fromInt } from "../fraction/fraction.ts";
import type { PauseRequest } from "../pause/pause.ts";
import {
  buildDoneCommitment,
  buildDoneEntry,
  buildMissedEntry,
  buildPauseRequest,
  buildQuantityCommitment,
  buildQuantityEntry,
  buildWeeklyTotalCommitment,
} from "../test-support/builders.ts";
import { commitmentWeeklySeries } from "./commitment-series.ts";
import { type ScoreInput, scoreMember } from "./member-score.ts";

/**
 * profile-habits-consistency (REQ-C4, SC-9): the Perfil "Consistencia histórica" pools the integer
 * `kept` / `counted` of every week of every commitment. Pooling is only sound if those sums are
 * EXACTLY the numerator and denominator `scoreMember` uses for the member consistency (R7), so this
 * pins that equivalence on the worked examples and on hand-built edge cases.
 */
function pooled(input: ScoreInput): { kept: number; counted: number } {
  let kept = 0;
  let counted = 0;
  for (const series of commitmentWeeklySeries(input)) {
    for (const week of series.weeks) {
      kept += week.kept;
      counted += week.counted;
    }
  }
  return { kept, counted };
}

function expectParity(input: ScoreInput): void {
  const { kept, counted } = pooled(input);
  const { consistency } = scoreMember(input);
  if (counted === 0) {
    expect(consistency).toBeNull();
    return;
  }
  expect(consistency).not.toBeNull();
  // Exact fractions are reduced, so equality of the reduced ratios is equality of the values.
  expect(consistency).toEqual(div(fromInt(kept), fromInt(counted)));
}

const range = (to: number): readonly number[] => Array.from({ length: to + 1 }, (_, i) => i);

describe("commitmentWeeklySeries kept/counted parity with scoreMember consistency", () => {
  it("the full participant season, on every day of and past the season (F5/G5/G6)", () => {
    for (const today of range(60)) {
      expectParity({ ...participantFullSeasonInput, today: seasonDay(today) });
    }
  });

  it.for(fMidSeasonRows)("$id mid-season snapshot", (row) => {
    expectParity({
      season: row.season,
      commitments: [row.commitment],
      entries: row.entries,
      pauses: row.pauses,
      today: row.today,
    });
  });

  it.for(nStreakRows)("$id frequency rows (timesPerWeek weekly window)", (row) => {
    expectParity({
      season: row.season,
      commitments: [row.commitment],
      entries: row.entries,
      pauses: [],
      today: row.today,
    });
  });

  it("E23: a pause in the middle of the season, on every day", () => {
    const row = eConsistencyRows[0];
    if (row === undefined) throw new Error("unreachable");
    const entries: Entry[] = [];
    for (const week of row.fullWeeks) {
      for (let i = 0; i < 5; i++) entries.push(buildDoneEntry("leer", week * 7 + i));
    }
    entries.push(
      buildDoneEntry("leer", row.partialWeek * 7),
      buildDoneEntry("leer", row.partialWeek * 7 + 1),
    );
    for (const today of range(90)) {
      expectParity({
        season: { lengthWeeks: 12, startWeekday: 0 },
        commitments: [row.commitment],
        entries,
        pauses: row.pauses,
        today: seasonDay(today),
      });
    }
    expect(
      pooled({
        season: { lengthWeeks: 12, startWeekday: 0 },
        commitments: [row.commitment],
        entries,
        pauses: row.pauses,
        today: seasonDay(row.today),
      }),
    ).toEqual({ kept: 27, counted: 30 });
  });

  describe("hand-built mixed member (specificDays, timesPerWeek, weeklyTotal)", () => {
    const season: Season = { lengthWeeks: 4, startWeekday: 0 };
    const reading = buildDoneCommitment("reading", 40, { kind: "specificDays", weekdays: [0, 2] });
    const gym = buildQuantityCommitment(
      "gym",
      30,
      "minutes",
      { direction: "reach", minimum: fromInt(20), ideal: fromInt(40) },
      { kind: "timesPerWeek", times: 3 },
    );
    const total = buildWeeklyTotalCommitment("total", 30, "minutes", {
      direction: "reach",
      minimum: fromInt(30),
      ideal: fromInt(60),
    });
    const entries: Entry[] = [
      buildDoneEntry("reading", 0),
      buildMissedEntry("reading", 2),
      buildDoneEntry("reading", 7),
      buildQuantityEntry("gym", 0, fromInt(45)),
      buildQuantityEntry("gym", 2, fromInt(10)),
      buildQuantityEntry("gym", 8, fromInt(25)),
      buildQuantityEntry("total", 3, fromInt(70)),
      buildQuantityEntry("total", 9, fromInt(10)),
    ];
    const rejected: PauseRequest = buildPauseRequest(
      "reading",
      7,
      { kind: "fixed", lastDay: seasonDay(9) },
      { kind: "rejected", decidedOn: seasonDay(8) },
    );
    const approved: PauseRequest = buildPauseRequest(
      "gym",
      14,
      { kind: "fixed", lastDay: seasonDay(18) },
      { kind: "approved", decidedOn: seasonDay(14), resumedOn: null },
    );
    const input = (today: number, pauses: readonly PauseRequest[]): ScoreInput => ({
      season,
      commitments: [reading, gym, total],
      entries,
      pauses,
      today: seasonDay(today),
    });

    it("holds on every day of the season and after it (mid-week, grace days, in progress)", () => {
      for (const today of range(32)) expectParity(input(today, []));
    });

    it("holds with an approved pause and a rejection extension, on every day", () => {
      for (const today of range(32)) expectParity(input(today, [rejected, approved]));
    });

    it("counts nothing, and the consistency is null, while only an open week is running", () => {
      const open: ScoreInput = { ...input(2, []), commitments: [total], entries: [] };
      expect(pooled(open)).toEqual({ kept: 0, counted: 0 });
      expect(scoreMember(open).consistency).toBeNull();
    });

    it("counted is 0 exactly when the consistency is null", () => {
      for (const today of range(32)) {
        const { counted } = pooled(input(today, [rejected, approved]));
        expect(counted === 0).toBe(
          scoreMember(input(today, [rejected, approved])).consistency === null,
        );
      }
    });
  });
});
