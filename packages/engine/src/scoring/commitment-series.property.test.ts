import { array, assert, constantFrom, integer, property, record, tuple } from "fast-check";
import { describe, expect, it } from "vitest";
import type { Season, Weekday } from "../calendar/season-calendar.ts";
import { seasonDay } from "../calendar/season-calendar.ts";
import type { Commitment, Direction, Frequency, Target } from "../commitment/commitment.ts";
import { eq, fromInt, sum } from "../fraction/fraction.ts";
import type { PauseDecision, PauseEnd } from "../pause/pause.ts";
import { weightPercentPartition } from "../test-support/arbitraries.ts";
import {
  buildPauseRequest,
  buildQuantityCommitment,
  buildQuantityEntry,
  buildWeeklyTotalCommitment,
} from "../test-support/builders.ts";
import { commitmentWeeklySeries, periodFigures, poolPeriodFigures } from "./commitment-series.ts";
import type { ScoreInput } from "./member-score.ts";
import { scoreMember } from "./member-score.ts";
import { weeklySeries } from "./weekly-series.ts";

const season: Season = { lengthWeeks: 4, startWeekday: 0 };
const totalDays = season.lengthWeeks * 7;

type ScheduleKind = "timesPerWeek" | "specificDays" | "weeklyTotal";

function sortedPair(a: number, b: number): readonly [number, number] {
  return a <= b ? [a, b] : [b, a];
}

function fuzzArbitrary() {
  return record({
    scheduleKind: constantFrom<ScheduleKind>("timesPerWeek", "specificDays", "weeklyTotal"),
    direction: constantFrom<Direction>("reach", "limit"),
    times: integer({ min: 1, max: 5 }),
    weekdays: array(integer({ min: 0, max: 6 }), { minLength: 1, maxLength: 7 }),
    thresholdA: integer({ min: 0, max: 20 }),
    thresholdB: integer({ min: 0, max: 20 }),
    entries: array(
      record({ day: integer({ min: 0, max: totalDays - 1 }), value: integer({ min: 0, max: 30 }) }),
      { maxLength: 10 },
    ),
    pauses: array(
      record({
        startDay: integer({ min: 0, max: totalDays - 1 }),
        decidedOffset: integer({ min: 0, max: 10 }),
        length: integer({ min: 0, max: totalDays }),
        endKind: constantFrom<"open" | "fixed">("open", "fixed"),
        decisionKind: constantFrom<"pending" | "approved" | "rejected">(
          "pending",
          "approved",
          "rejected",
        ),
      }),
      { maxLength: 2 },
    ),
  });
}

function targetFor(direction: Direction, a: number, b: number): Target {
  const [low, high] = sortedPair(a, b);
  if (direction === "reach") {
    return {
      direction,
      minimum: fromInt(low === 0 ? 1 : low),
      ideal: fromInt(high === 0 ? 1 : high),
    };
  }
  return { direction, ideal: fromInt(low), tolerance: fromInt(high) };
}

function frequencyFor(kind: ScheduleKind, times: number, weekdays: readonly number[]): Frequency {
  if (kind === "specificDays") {
    const unique = [...new Set(weekdays)] as readonly Weekday[];
    return { kind: "specificDays", weekdays: unique.length > 0 ? unique : [0] };
  }
  return { kind: "timesPerWeek", times };
}

const inputArbitrary = integer({ min: 1, max: 4 })
  .chain((count) =>
    tuple(
      weightPercentPartition(count),
      array(fuzzArbitrary(), { minLength: count, maxLength: count }),
      integer({ min: 0, max: totalDays + 5 }),
    ),
  )
  .map(([weights, fuzzes, today]): ScoreInput => {
    const commitments = weights.map((weightPercent, i): Commitment => {
      const fuzz = fuzzes[i];
      const direction: Direction = fuzz?.direction ?? "reach";
      const target = targetFor(direction, fuzz?.thresholdA ?? 1, fuzz?.thresholdB ?? 1);
      const id = `c${i}`;
      if ((fuzz?.scheduleKind ?? "timesPerWeek") === "weeklyTotal") {
        return buildWeeklyTotalCommitment(id, weightPercent, "minutes", target);
      }
      const frequency = frequencyFor(
        fuzz?.scheduleKind ?? "timesPerWeek",
        fuzz?.times ?? 1,
        fuzz?.weekdays ?? [0],
      );
      return buildQuantityCommitment(id, weightPercent, "minutes", target, frequency);
    });
    const entries = weights.flatMap((_, i) =>
      (fuzzes[i]?.entries ?? []).map((e) => buildQuantityEntry(`c${i}`, e.day, fromInt(e.value))),
    );
    const pauses = weights.flatMap((_, i) =>
      (fuzzes[i]?.pauses ?? []).map((p) => {
        const uncapped = p.startDay + p.length;
        const lastDay = seasonDay(uncapped < totalDays ? uncapped : totalDays - 1);
        const end: PauseEnd = p.endKind === "open" ? { kind: "open" } : { kind: "fixed", lastDay };
        const decidedOn = seasonDay(p.startDay + p.decidedOffset);
        const decision: PauseDecision =
          p.decisionKind === "pending"
            ? { kind: "pending" }
            : p.decisionKind === "approved"
              ? { kind: "approved", decidedOn, resumedOn: null }
              : { kind: "rejected", decidedOn };
        return buildPauseRequest(`c${i}`, p.startDay, end, decision);
      }),
    );
    return { season, commitments, entries, pauses, today: seasonDay(today) };
  });

describe("commitmentWeeklySeries (property-based)", () => {
  it("the commitments of each week add up exactly to weeklySeries' week", () => {
    assert(
      property(inputArbitrary, (input) => {
        const member = weeklySeries(input);
        const perCommitment = commitmentWeeklySeries(input);
        for (const row of member) {
          const parts = perCommitment.map((c) => c.weeks[row.week]);
          expect(eq(sum(parts.map((p) => p?.points ?? fromInt(0))), row.points)).toBe(true);
          expect(eq(sum(parts.map((p) => p?.potential ?? fromInt(0))), row.potential)).toBe(true);
          expect(parts.reduce((n, p) => n + (p?.counted ?? 0), 0)).toBe(row.counted);
          expect(parts.reduce((n, p) => n + (p?.kept ?? 0), 0)).toBe(row.kept);
          expect(parts.reduce((n, p) => n + (p?.opportunities ?? 0), 0)).toBe(row.opportunities);
        }
      }),
    );
  });

  it("the whole-season range equals the engine totals, and period points add up (REQ-U3, REQ-U6)", () => {
    assert(
      property(inputArbitrary, (input) => {
        const score = scoreMember(input);
        const series = commitmentWeeklySeries(input);
        const whole = series.map((c) => periodFigures(c.weeks, 0, season.lengthWeeks - 1));
        for (const [i, entry] of score.commitments.entries()) {
          const figures = whole[i];
          expect(figures?.points).toEqual(entry.points);
          expect(figures?.consistency).toEqual(entry.consistency);
          expect(figures?.idealCompletion).toEqual(entry.idealCompletion);
        }
        expect(eq(poolPeriodFigures(whole).points, score.points)).toBe(true);

        const halves = series.flatMap((c) => [
          periodFigures(c.weeks, 0, 1),
          periodFigures(c.weeks, 2, 3),
        ]);
        expect(eq(sum(halves.map((h) => h.points)), score.points)).toBe(true);
      }),
    );
  });
});
