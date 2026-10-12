/**
 * The maturity stage of a habit's commitment (new / developing / integrated / graduated),
 * DERIVED on every read from data and never stored (Q5): it can regress, and only graduation is
 * permanent (a stored decision the caller passes as `graduated`).
 *
 * Rules, in order (REQ-H3):
 * 1. `graduated` iff the user graduated the habit.
 * 2. `integrated` iff the most recent `integratedWeeks` COUNTED final weeks EACH reached
 *    `integratedConsistency` (a sustained run, not a pooled rate) AND the latest automaticity is at
 *    least `integratedAutomaticity`. Without any automaticity score integrated is unreachable.
 * 3. `developing` iff the last completed review period reached `developingConsistency`.
 * 4. otherwise `new` (so a fall below the developing threshold regresses to `new`).
 *
 * Weeks with nothing counted (paused) are neutral: they neither count toward nor break the run.
 * The caller passes only COMPLETED weeks (the one in progress is ignored upstream) and the last
 * completed period that has something counted (REQ-H5, REQ-H6). Comparisons are inclusive and
 * exact. Every threshold lives in `HABIT_STAGE_THRESHOLDS` (REQ-H9): changing it changes the
 * result with no data migration. The numbers are NOT calibrated yet (ADR-0014).
 *
 * Pure: no clock, no I/O.
 */
import type { Fraction } from "../fraction/fraction.ts";
import { div, frac, fromInt, gte } from "../fraction/fraction.ts";

export type HabitStage = "new" | "developing" | "integrated" | "graduated";

/** Kept and counted opportunities of one week or one period. */
export interface StageCounts {
  readonly kept: number;
  readonly counted: number;
}

export interface HabitStageInput {
  /** Completed weeks in order, oldest first (a week in progress is not here). Zero-counted weeks are neutral. */
  readonly finalWeeks: readonly StageCounts[];
  /** The most recent ended review period with something counted; `null` when there is none yet. */
  readonly lastPeriod: StageCounts | null;
  /** The commitment's latest stored automaticity; `null` without any score. */
  readonly automaticity: Fraction | null;
  /** The user decided to stop tracking the habit. */
  readonly graduated: boolean;
}

export interface HabitStageThresholds {
  /** Last period consistency (inclusive) for `developing`. */
  readonly developingConsistency: Fraction;
  /** Each week's consistency (inclusive) of the sustained run for `integrated`. */
  readonly integratedConsistency: Fraction;
  /** Counted weeks the run needs. */
  readonly integratedWeeks: number;
  /** Latest automaticity (inclusive) for `integrated`. */
  readonly integratedAutomaticity: Fraction;
}

export const HABIT_STAGE_THRESHOLDS: HabitStageThresholds = {
  developingConsistency: frac(3n, 5n),
  integratedConsistency: frac(4n, 5n),
  integratedWeeks: 4,
  integratedAutomaticity: fromInt(5),
};

function reaches(counts: StageCounts, threshold: Fraction): boolean {
  return counts.counted > 0 && gte(div(fromInt(counts.kept), fromInt(counts.counted)), threshold);
}

function isSustained(weeks: readonly StageCounts[], thresholds: HabitStageThresholds): boolean {
  const counted = weeks.filter((week) => week.counted > 0);
  if (counted.length < thresholds.integratedWeeks) return false;
  return counted
    .slice(counted.length - thresholds.integratedWeeks)
    .every((week) => reaches(week, thresholds.integratedConsistency));
}

export function deriveHabitStage(
  input: HabitStageInput,
  thresholds: HabitStageThresholds = HABIT_STAGE_THRESHOLDS,
): HabitStage {
  if (input.graduated) return "graduated";
  if (
    input.automaticity !== null &&
    gte(input.automaticity, thresholds.integratedAutomaticity) &&
    isSustained(input.finalWeeks, thresholds)
  ) {
    return "integrated";
  }
  if (input.lastPeriod !== null && reaches(input.lastPeriod, thresholds.developingConsistency)) {
    return "developing";
  }
  return "new";
}
