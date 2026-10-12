import { describe, expect, it } from "vitest";
import { seasonDay } from "../calendar/season-calendar.ts";
import { eq, fromInt, sum } from "../fraction/fraction.ts";
import {
  buildDoneCommitment,
  buildDoneEntry,
  buildPauseRequest,
  buildQuantityEntry,
  buildWeeklyTotalCommitment,
} from "../test-support/builders.ts";
import { fr } from "../test-support/fraction-literal.ts";
import { commitmentWeeklySeries, periodFigures, poolPeriodFigures } from "./commitment-series.ts";
import { type ScoreInput, scoreMember } from "./member-score.ts";

// 4-week season, week 0 = days 0-6; a week's grace deadline is the day after it ends.
const reading = buildDoneCommitment("reading", 60, { kind: "specificDays", weekdays: [0, 2] });
const total = buildWeeklyTotalCommitment("total", 40, "minutes", {
  direction: "reach",
  minimum: fromInt(30),
  ideal: fromInt(60),
});
const snapshot = (overrides: Partial<ScoreInput> = {}): ScoreInput => ({
  season: { lengthWeeks: 4, startWeekday: 0 },
  commitments: [reading, total],
  entries: [],
  pauses: [],
  today: seasonDay(0),
  ...overrides,
});

function seriesOf(input: ScoreInput, id: string) {
  const found = commitmentWeeklySeries(input).find((c) => c.commitmentId === id);
  if (found === undefined) throw new Error(`no series for ${id}`);
  return found.weeks;
}

describe("commitmentWeeklySeries (REQ-E1)", () => {
  it("one series per commitment, one row per season week, in commitment order", () => {
    const series = commitmentWeeklySeries(snapshot());

    expect(series.map((c) => c.commitmentId)).toEqual(["reading", "total"]);
    for (const c of series) expect(c.weeks.map((w) => w.week)).toEqual([0, 1, 2, 3]);
  });

  it("values a week over the commitment's whole-season opportunities (SC-60)", () => {
    // total: 40 % = 400 points over 4 weekly opportunities = 100 each.
    const entries = [
      buildQuantityEntry("total", 7, fromInt(60)),
      buildQuantityEntry("total", 14, fromInt(60)),
    ];
    const weeks = seriesOf(snapshot({ entries, today: seasonDay(30) }), "total");

    expect(weeks[1]).toMatchObject({ points: fromInt(100), counted: 1, kept: 1 });
    expect(weeks[2]).toMatchObject({ points: fromInt(100), counted: 1, kept: 1 });
    expect(weeks[0]).toMatchObject({ points: fromInt(0), counted: 1, kept: 0 });
  });

  it("a week paused whole has nothing counted and no figures (SC-64)", () => {
    const pauses = [
      buildPauseRequest(
        "total",
        14,
        { kind: "fixed", lastDay: seasonDay(27) },
        { kind: "approved", decidedOn: seasonDay(14), resumedOn: null },
      ),
    ];
    const weeks = seriesOf(snapshot({ pauses, today: seasonDay(30) }), "total");

    expect(weeks[2]).toMatchObject({ opportunities: 0, counted: 0, consistency: null });
    expect(weeks[2]?.idealCompletion).toBeNull();
  });

  it("a paused week re-values the others over the remaining opportunities (D12)", () => {
    const pauses = [
      buildPauseRequest(
        "total",
        0,
        { kind: "fixed", lastDay: seasonDay(6) },
        { kind: "approved", decidedOn: seasonDay(0), resumedOn: null },
      ),
    ];
    const entries = [buildQuantityEntry("total", 7, fromInt(60))];
    const weeks = seriesOf(snapshot({ entries, pauses, today: seasonDay(30) }), "total");

    expect(weeks).toHaveLength(4);
    expect(weeks[0]).toMatchObject({ opportunities: 0, counted: 0 });
    // 400 points over the 3 remaining weekly opportunities.
    expect(weeks[1]?.points).toEqual(fr("400/3"));
  });
});

describe("periodFigures (REQ-U1..U7)", () => {
  const entries = [
    buildDoneEntry("reading", 0),
    buildDoneEntry("reading", 2),
    buildDoneEntry("reading", 7),
    buildQuantityEntry("total", 7, fromInt(60)),
    buildQuantityEntry("total", 14, fromInt(30)),
  ];
  const input = snapshot({ entries, today: seasonDay(30) });

  it("pools kept, counted and points over the weeks of the range, bounds inclusive", () => {
    const figures = periodFigures(seriesOf(input, "total"), 1, 2);

    // week 1 at progress 1 (100), week 2 at the minimum (30/60 reach -> 50 %: 50).
    expect(figures).toMatchObject({ counted: 2, kept: 2, opportunities: 2 });
    expect(figures.points).toEqual(fromInt(150));
    expect(figures.potential).toEqual(fromInt(200));
    expect(figures.consistency).toEqual(fromInt(1));
    expect(figures.idealCompletion).toEqual(fr("3/4"));
    expect(figures.final).toBe(true);
    expect(figures.editable).toBe(false);
  });

  it("a range with nothing counted has absent figures (REQ-U5)", () => {
    const early = snapshot({ entries, today: seasonDay(0) });
    const figures = periodFigures(seriesOf(early, "total"), 2, 3);

    expect(figures).toMatchObject({ counted: 0, kept: 0 });
    expect(figures.consistency).toBeNull();
    expect(figures.idealCompletion).toBeNull();
  });

  it("reports that the last week is still inside its grace so figures can change (REQ-U7)", () => {
    // day 28 is the day after the season's last day (27): the last week is on its grace day.
    const onGrace = snapshot({ entries, today: seasonDay(28) });
    const during = periodFigures(seriesOf(onGrace, "total"), 2, 3);
    expect(during.editable).toBe(true);
    expect(during.final).toBe(false);

    const after = snapshot({ entries, today: seasonDay(29) });
    const closed = periodFigures(seriesOf(after, "total"), 2, 3);
    expect(closed.editable).toBe(false);
    expect(closed.final).toBe(true);
  });

  it("the whole-season range equals the engine's season totals per commitment (REQ-U6, SC-65)", () => {
    const score = scoreMember(input);
    for (const entry of score.commitments) {
      const figures = periodFigures(seriesOf(input, entry.commitmentId), 0, 3);
      expect(figures.points).toEqual(entry.points);
      expect(figures.consistency).toEqual(entry.consistency);
      expect(figures.idealCompletion).toEqual(entry.idealCompletion);
    }
  });

  it("the period points of consecutive ranges add up to the season points (SC-61, REQ-U3)", () => {
    const score = scoreMember(input);
    for (const entry of score.commitments) {
      const weeks = seriesOf(input, entry.commitmentId);
      const parts = [periodFigures(weeks, 0, 1), periodFigures(weeks, 2, 3)];
      expect(eq(sum(parts.map((p) => p.points)), entry.points)).toBe(true);
    }
  });
});

describe("poolPeriodFigures (REQ-U4)", () => {
  it("pools counted and kept over commitments, not an average of ratios", () => {
    const entries = [buildDoneEntry("reading", 0), buildQuantityEntry("total", 7, fromInt(60))];
    const input = snapshot({ entries, today: seasonDay(30) });
    const parts = commitmentWeeklySeries(input).map((c) => periodFigures(c.weeks, 0, 1));
    const pooled = poolPeriodFigures(parts);

    // reading: 4 scheduled days in weeks 0-1, 1 kept. total: 2 weeks, 1 kept.
    expect(pooled).toMatchObject({ counted: 6, kept: 2 });
    expect(pooled.consistency).toEqual(fr("1/3"));
    expect(eq(pooled.points, sum(parts.map((p) => p.points)))).toBe(true);
  });

  it("an empty list is all zero with absent ratios", () => {
    const pooled = poolPeriodFigures([]);

    expect(pooled).toMatchObject({ counted: 0, kept: 0, opportunities: 0, editable: false });
    expect(pooled.consistency).toBeNull();
    expect(pooled.idealCompletion).toBeNull();
  });
});
