/** Read facts from the same pause-aware, R1-gated walk as scoreMember. */
import type { Commitment } from "../commitment/commitment.ts";
import type { Fraction } from "../fraction/fraction.ts";
import { fromInt } from "../fraction/fraction.ts";
import { type ScoreInput, seasonSessions } from "./member-score.ts";
import { opportunityValue } from "./opportunity-points.ts";

export interface OpportunityCounts {
  /** Counted opportunities that reached their minimum (consistency numerator). */
  readonly kept: number;
  /** R1-gated opportunities, including counted misses (consistency denominator). */
  readonly counted: number;
  /** Active opportunities across the WHOLE season (D12 points denominator). */
  readonly total: number;
  /** Exact points at 100%; zero when every opportunity is excluded. */
  readonly perOpportunityPoints: Fraction;
}

/** No rounding and no provisional weekly-window counts, even with entries. */
export function opportunityCounts(commitment: Commitment, input: ScoreInput): OpportunityCounts {
  const { all, soFar } = seasonSessions(commitment, input);
  return {
    kept: soFar.filter((session) => session.consistent).length,
    counted: soFar.length,
    total: all.length,
    perOpportunityPoints: all.length === 0 ? fromInt(0) : opportunityValue(commitment, all.length),
  };
}
