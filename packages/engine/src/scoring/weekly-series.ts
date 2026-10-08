/**
 * The season week by week for one member (design 23a chart, 25b/25c summary), read from the SAME
 * pause-aware, R1-gated walk as `scoreMember` (`seasonSessions`), so a week can never disagree
 * with the season total:
 *
 * - `points`: exact sum of the week's COUNTED opportunities, each worth its commitment's potential
 *   over its whole-season active opportunities (D12, current allocation). Recomputed live: a pause
 *   elsewhere re-values past weeks, nothing is a snapshot. A weekly-window opportunity
 *   (`timesPerWeek`, `weeklyTotal`) adds nothing before its week closes plus grace (R1): no
 *   provisional points. The weeks add up exactly to `scoreMember(input).points`.
 * - `consistency`: kept / counted opportunities of the week, pooled over commitments (R7's rule
 *   applied to one week); `null` while nothing has counted.
 * - `idealCompletion`: the week's points over the potential of its counted opportunities (owner
 *   decision 2026-10-08, D1's "points / potential"); `null` while nothing has counted.
 * - `editable` / `final`: independent facts. On a grace day an opportunity is counted AND still
 *   editable; it is final only after its deadline.
 *
 * No rounding here: display rounding happens once, at the app's display boundary (D10).
 */
import { seasonDay } from "../calendar/season-calendar.ts";
import { graceDeadline } from "../entry/grace-period.ts";
import type { Fraction } from "../fraction/fraction.ts";
import { add, div, fromInt, mul } from "../fraction/fraction.ts";
import { type ScoreInput, seasonSessions } from "./member-score.ts";
import { opportunityValue } from "./opportunity-points.ts";

const DAYS_PER_WEEK = 7;

export interface WeekFigures {
  /** 0-based season week. */
  readonly week: number;
  readonly points: Fraction;
  /** Points the week's counted opportunities could have given at 100 %. */
  readonly potential: Fraction;
  /** Active (not paused, not on hold) opportunities of the week. */
  readonly opportunities: number;
  readonly counted: number;
  /** Counted opportunities that reached the minimum (or stayed within tolerance). */
  readonly kept: number;
  readonly consistency: Fraction | null;
  readonly idealCompletion: Fraction | null;
  /** Some opportunity of the week can still be registered or edited. */
  readonly editable: boolean;
  /** Every opportunity is past its deadline (a week without any: once the week's grace is over). */
  readonly final: boolean;
}

interface Totals {
  points: Fraction;
  potential: Fraction;
  opportunities: number;
  counted: number;
  kept: number;
  editable: boolean;
  allFinal: boolean;
}

export function weeklySeries(input: ScoreInput): readonly WeekFigures[] {
  const totals: Totals[] = Array.from({ length: input.season.lengthWeeks }, () => ({
    points: fromInt(0),
    potential: fromInt(0),
    opportunities: 0,
    counted: 0,
    kept: 0,
    editable: false,
    allFinal: true,
  }));

  for (const commitment of input.commitments) {
    const { all, weeks } = seasonSessions(commitment, input);
    if (all.length === 0) continue;
    const value = opportunityValue(commitment, all.length);
    for (const { week, opportunities } of weeks) {
      const total = totals[week];
      if (total === undefined) continue;
      for (const opportunity of opportunities) {
        total.opportunities += 1;
        total.editable ||= opportunity.editable;
        total.allFinal &&= opportunity.final;
        if (!opportunity.counted) continue;
        total.counted += 1;
        if (opportunity.session.consistent) total.kept += 1;
        total.points = add(total.points, mul(value, opportunity.session.progress));
        total.potential = add(total.potential, value);
      }
    }
  }

  return totals.map((total, week) => {
    const weekGraceOver =
      input.today > graceDeadline(seasonDay(week * DAYS_PER_WEEK + DAYS_PER_WEEK - 1));
    return {
      week,
      points: total.points,
      potential: total.potential,
      opportunities: total.opportunities,
      counted: total.counted,
      kept: total.kept,
      consistency: total.counted === 0 ? null : div(fromInt(total.kept), fromInt(total.counted)),
      idealCompletion: total.counted === 0 ? null : div(total.points, total.potential),
      editable: total.editable,
      final: total.opportunities === 0 ? weekGraceOver : total.allFinal,
    };
  });
}
