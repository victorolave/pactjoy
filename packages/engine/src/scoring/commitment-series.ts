/**
 * The season week by week for EACH commitment, and the figures of a range of weeks (a review
 * period, screen 33). `weeklySeries` stays the member-level series, untouched; this is its
 * per-commitment split, read from the SAME `seasonSessions` walk (same R1 gate, same D12 values,
 * same pause handling), so the commitments of a week add up exactly to `weeklySeries`'s week
 * (pinned by a property test).
 *
 * - `points` of a week is the commitment's contribution to the SEASON points (its weight over the
 *   commitment's whole-season active opportunities, D12), so the period points of consecutive
 *   ranges add up to the commitment's season points and the member total is the sum over
 *   commitments. Consistency and idealCompletion are ratios and do NOT add up: a range pools its
 *   counted opportunities (R7's rule, as `weeklySeries` does for one week).
 * - A range with nothing counted (fully paused, or not closed yet) has `null` ratios.
 *
 * Weeks are 0-based, like `WeekFigures.week`. No rounding here (D10).
 */
import { seasonDay } from "../calendar/season-calendar.ts";
import type { CommitmentId } from "../commitment/commitment.ts";
import { graceDeadline } from "../entry/grace-period.ts";
import type { Fraction } from "../fraction/fraction.ts";
import { add, div, fromInt, mul } from "../fraction/fraction.ts";
import { type ScoreInput, seasonSessions } from "./member-score.ts";
import { opportunityValue } from "./opportunity-points.ts";
import type { WeekFigures } from "./weekly-series.ts";

const DAYS_PER_WEEK = 7;

export interface CommitmentWeeklySeries {
  readonly commitmentId: CommitmentId;
  /** One row per season week, in order. */
  readonly weeks: readonly WeekFigures[];
}

/** The figures of a range of weeks for one commitment, or pooled over several (`poolPeriodFigures`). */
export interface PeriodFigures {
  readonly points: Fraction;
  /** Points the range's counted opportunities could have given at 100 %. */
  readonly potential: Fraction;
  /** Active (not paused, not on hold) opportunities of the range. */
  readonly opportunities: number;
  readonly counted: number;
  /** Counted opportunities that reached the minimum (or stayed within tolerance). */
  readonly kept: number;
  readonly consistency: Fraction | null;
  readonly idealCompletion: Fraction | null;
  /** Some opportunity of the range can still be registered or edited (the figures can still change). */
  readonly editable: boolean;
  /** Every week of the range is final. */
  readonly final: boolean;
}

export function commitmentWeeklySeries(input: ScoreInput): readonly CommitmentWeeklySeries[] {
  return input.commitments.map((commitment) => {
    const { all, weeks: walked } = seasonSessions(commitment, input);
    const value = all.length === 0 ? null : opportunityValue(commitment, all.length);
    const weeks = Array.from({ length: input.season.lengthWeeks }, (_, week): WeekFigures => {
      let points = fromInt(0);
      let potential = fromInt(0);
      let opportunities = 0;
      let counted = 0;
      let kept = 0;
      let editable = false;
      let allFinal = true;
      for (const opportunity of walked[week]?.opportunities ?? []) {
        opportunities += 1;
        editable ||= opportunity.editable;
        allFinal &&= opportunity.final;
        if (!opportunity.counted || value === null) continue;
        counted += 1;
        if (opportunity.session.consistent) kept += 1;
        points = add(points, mul(value, opportunity.session.progress));
        potential = add(potential, value);
      }
      const weekGraceOver =
        input.today > graceDeadline(seasonDay(week * DAYS_PER_WEEK + DAYS_PER_WEEK - 1));
      return {
        week,
        points,
        potential,
        opportunities,
        counted,
        kept,
        consistency: counted === 0 ? null : div(fromInt(kept), fromInt(counted)),
        idealCompletion: counted === 0 ? null : div(points, potential),
        editable,
        final: opportunities === 0 ? weekGraceOver : allFinal,
      };
    });
    return { commitmentId: commitment.id, weeks };
  });
}

function figuresOf(
  points: Fraction,
  potential: Fraction,
  opportunities: number,
  counted: number,
  kept: number,
  editable: boolean,
  final: boolean,
): PeriodFigures {
  return {
    points,
    potential,
    opportunities,
    counted,
    kept,
    consistency: counted === 0 ? null : div(fromInt(kept), fromInt(counted)),
    idealCompletion: counted === 0 ? null : div(points, potential),
    editable,
    final,
  };
}

/** The figures of the weeks `first..last` (0-based, inclusive) of one series. */
export function periodFigures(
  weeks: readonly WeekFigures[],
  first: number,
  last: number,
): PeriodFigures {
  const inRange = weeks.filter((week) => week.week >= first && week.week <= last);
  return poolWeeks(inRange);
}

function poolWeeks(list: readonly (WeekFigures | PeriodFigures)[]): PeriodFigures {
  let points = fromInt(0);
  let potential = fromInt(0);
  let opportunities = 0;
  let counted = 0;
  let kept = 0;
  let editable = false;
  let final = true;
  for (const part of list) {
    points = add(points, part.points);
    potential = add(potential, part.potential);
    opportunities += part.opportunities;
    counted += part.counted;
    kept += part.kept;
    editable ||= part.editable;
    final &&= part.final;
  }
  return figuresOf(points, potential, opportunities, counted, kept, editable, final);
}

/** The member total of a period: the commitments' figures pooled (REQ-U4), points summed. */
export function poolPeriodFigures(list: readonly PeriodFigures[]): PeriodFigures {
  return poolWeeks(list);
}
