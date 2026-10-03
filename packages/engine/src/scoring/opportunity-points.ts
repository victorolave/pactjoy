/**
 * What ONE opportunity is worth, for the read models that show a member
 * "+4 pts" next to a registro. It is the same arithmetic `scoreCommitmentSoFar`
 * applies to the whole season (D12: `weight x 1000 x progress / active
 * opportunities of the season`), cut down to a single opportunity so the rule
 * stays in the engine and no client re-derives it. Exact `Fraction`s all the
 * way; rounding for display is `display/display.ts`'s job alone (D10).
 */
import type { Commitment, Target } from "../commitment/commitment.ts";
import { targetOf } from "../commitment/commitment.ts";
import type { Entry } from "../entry/entry.ts";
import type { Fraction } from "../fraction/fraction.ts";
import { div, fromInt, mul, sum } from "../fraction/fraction.ts";
import { sumEntryValues } from "../opportunity/per-session.ts";
import { progressOf } from "../progress/progress.ts";

const WEIGHT_TO_POINTS = fromInt(10); // weightPercent (0-100) x 10 = weight x 1000

function targetFor(commitment: Commitment): Target {
  return commitment.unit === "done" ? targetOf(commitment) : commitment.target;
}

/**
 * Points an opportunity of `commitment` is worth at 100 %: the commitment's
 * potential spread over the season's active opportunities (Mechanics: "valor
 * de cada oportunidad = potencial / oportunidades activas de la temporada").
 * `activeOpportunities` must be positive.
 */
export function opportunityValue(commitment: Commitment, activeOpportunities: number): Fraction {
  return div(
    mul(fromInt(commitment.weightPercent), WEIGHT_TO_POINTS),
    fromInt(activeOpportunities),
  );
}

/**
 * The progress one opportunity reaches at `value` (`null` = nothing logged).
 * Lets a read model show what each choice would score before it is made.
 */
export function progressAtValue(commitment: Commitment, value: Fraction | null): Fraction {
  return progressOf(targetFor(commitment), value);
}

/** Adds exact points (e.g. everything earned today) so the caller rounds once, at display. */
export function sumPoints(points: readonly Fraction[]): Fraction {
  return sum(points);
}

/**
 * Points that the entries of ONE opportunity earn: they are summed first (D4,
 * same-day entries add up; `done` counts 1, `missed` 0), then scored. Zero
 * when there are no entries or the season has no active opportunity.
 */
export function opportunityPoints(
  commitment: Commitment,
  activeOpportunities: number,
  entries: readonly Entry[],
): Fraction {
  if (activeOpportunities <= 0 || entries.length === 0) return fromInt(0);
  const progress = progressAtValue(commitment, sumEntryValues(entries));
  return mul(opportunityValue(commitment, activeOpportunities), progress);
}
