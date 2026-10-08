import { describe, expect, it } from "vitest";
import { seasonDay } from "../calendar/season-calendar.ts";
import { div, eq, fromInt, sum } from "../fraction/fraction.ts";
import {
  buildDoneCommitment,
  buildDoneEntry,
  buildPauseRequest,
  buildQuantityCommitment,
  buildQuantityEntry,
  buildWeeklyTotalCommitment,
} from "../test-support/builders.ts";
import { fr } from "../test-support/fraction-literal.ts";
import { type ScoreInput, scoreMember } from "./member-score.ts";
import { weeklySeries } from "./weekly-series.ts";

// 4-week season; week 0 = days 0-6, its grace deadline is day 7.
const daily = buildDoneCommitment("daily", 50, { kind: "specificDays", weekdays: [0, 2] });
const weekly = buildDoneCommitment("weekly", 50, { kind: "timesPerWeek", times: 2 });
const reading = buildQuantityCommitment(
  "reading",
  100,
  "minutes",
  { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) },
  { kind: "specificDays", weekdays: [0] },
);
const total = buildWeeklyTotalCommitment("total", 100, "minutes", {
  direction: "reach",
  minimum: fromInt(30),
  ideal: fromInt(60),
});
const snapshot = (overrides: Partial<ScoreInput> = {}): ScoreInput => ({
  season: { lengthWeeks: 4, startWeekday: 0 },
  commitments: [daily, weekly],
  entries: [],
  pauses: [],
  today: seasonDay(0),
  ...overrides,
});

describe("weeklySeries (E2)", () => {
  it("one row per season week, nothing counted at the start", () => {
    const series = weeklySeries(snapshot());

    expect(series.map((week) => week.week)).toEqual([0, 1, 2, 3]);
    expect(series[0]).toMatchObject({
      points: fromInt(0),
      opportunities: 4,
      counted: 0,
      kept: 0,
      consistency: null,
      idealCompletion: null,
      editable: true,
      final: false,
    });
  });

  it("a day-bound opportunity counts at once; a weekly window gives NO points before close + grace", () => {
    const entries = [
      buildDoneEntry("daily", 0),
      buildDoneEntry("weekly", 0),
      buildDoneEntry("weekly", 1),
    ];
    const midWeek = weeklySeries(snapshot({ entries, today: seasonDay(2) }))[0];
    // daily: 50 % over 8 opportunities = 62.5 each; day 0 done, day 2 is today and unlogged.
    expect(midWeek).toMatchObject({ points: fr("125/2"), counted: 1, kept: 1 });

    const graceDay = weeklySeries(snapshot({ entries, today: seasonDay(7) }))[0];
    // weekly: 2 sessions done of 2 at 500/8 each now count; day 2 is past its grace (a miss).
    expect(graceDay).toMatchObject({ points: fr("375/2"), counted: 4, kept: 3 });
    expect(graceDay?.consistency).toEqual(fr("3/4"));
  });

  it("on the week's own grace day it is counted AND still editable; the next day it is final", () => {
    const entries = [buildDoneEntry("weekly", 0)];
    const commitments = [weekly];
    const grace = weeklySeries(snapshot({ commitments, entries, today: seasonDay(7) }))[0];
    expect(grace).toMatchObject({ counted: 2, editable: true, final: false });

    const after = weeklySeries(snapshot({ commitments, entries, today: seasonDay(8) }))[0];
    expect(after).toMatchObject({ counted: 2, editable: false, final: true });
  });

  it("the week's ideal is its points over the potential of what counted (owner decision)", () => {
    const entries = [buildQuantityEntry("reading", 0, fromInt(10))];
    const [week] = weeklySeries(snapshot({ commitments: [reading], entries, today: seasonDay(1) }));

    // 1 counted opportunity worth 250 at 100 %, at 1/3 progress.
    expect(week?.points).toEqual(fr("250/3"));
    expect(week?.idealCompletion).toEqual(fr("1/3"));
    expect(week?.consistency).toEqual(fromInt(1));
  });

  it("a weekly total counts as one opportunity once its week closes", () => {
    const entries = [
      buildQuantityEntry("total", 0, fromInt(30)),
      buildQuantityEntry("total", 3, fromInt(30)),
    ];
    const [open] = weeklySeries(snapshot({ commitments: [total], entries, today: seasonDay(6) }));
    expect(open).toMatchObject({ opportunities: 1, counted: 0, points: fromInt(0) });

    const [closed] = weeklySeries(snapshot({ commitments: [total], entries, today: seasonDay(7) }));
    expect(closed).toMatchObject({ opportunities: 1, counted: 1, kept: 1, points: fromInt(250) });
  });

  it("a week paused whole has no opportunities and is neither counted nor final early", () => {
    const pauses = [
      buildPauseRequest(
        "weekly",
        7,
        { kind: "fixed", lastDay: seasonDay(13) },
        { kind: "approved", decidedOn: seasonDay(7), resumedOn: null },
      ),
    ];
    const series = weeklySeries(snapshot({ commitments: [weekly], pauses, today: seasonDay(8) }));

    expect(series[1]).toMatchObject({ opportunities: 0, counted: 0, final: false });
    expect(series[1]?.consistency).toBeNull();
  });

  it("weeks recompute live under the current allocation and add up to the season's exact points", () => {
    const entries = [
      buildDoneEntry("daily", 0),
      buildDoneEntry("daily", 9),
      buildDoneEntry("weekly", 1),
      buildDoneEntry("weekly", 2),
      buildDoneEntry("weekly", 15),
    ];
    for (const day of [3, 10, 20, 30]) {
      const input = snapshot({ entries, today: seasonDay(day) });
      const weeks = sum(weeklySeries(input).map((week) => week.points));
      expect(eq(weeks, scoreMember(input).points)).toBe(true);
    }
  });

  it("pausing a later week re-values earlier weeks (no frozen snapshot)", () => {
    const entries = [buildDoneEntry("weekly", 0), buildDoneEntry("weekly", 1)];
    const before = weeklySeries(snapshot({ commitments: [weekly], entries, today: seasonDay(8) }));
    const pauses = [
      buildPauseRequest(
        "weekly",
        14,
        { kind: "fixed", lastDay: seasonDay(27) },
        { kind: "approved", decidedOn: seasonDay(8), resumedOn: null },
        8,
      ),
    ];
    const after = weeklySeries(
      snapshot({ commitments: [weekly], entries, pauses, today: seasonDay(8) }),
    );

    // 500 (50 %) over 8 sessions = 62.5 each; over the 4 still active = 125 each.
    expect(before[0]?.points).toEqual(fromInt(125));
    expect(after[0]?.points).toEqual(fromInt(250));
    expect(after[0]?.idealCompletion).toEqual(div(fromInt(250), fromInt(250)));
  });
});
