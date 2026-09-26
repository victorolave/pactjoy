/**
 * Minimal per-session commitment score: proves the per-session opportunity
 * generation (slice 3) wires into a scoring shape end-to-end. Member-level
 * aggregation (D2), pause and streak arrive in later slices.
 */
import type { Fraction } from "../fraction/fraction";
import { div, fromInt, mean, mul } from "../fraction/fraction";
import type { SessionResult } from "../opportunity/per-session";

export interface CommitmentScore {
  /** weightPercent x 1000 x mean(progress of every opportunity). 0 with zero opportunities (R6). */
  readonly points: Fraction;
  /** reached/total. `null` with zero counted opportunities (R6) — not `0`. */
  readonly consistency: Fraction | null;
}

const WEIGHT_TO_POINTS = fromInt(10); // weightPercent (0-100) x 10 = weight x 1000

/**
 * Aggregates one commitment's `perSession` week(s) into points and
 * consistency. `sessions` is the flat list of every opportunity generated
 * for this commitment so far (across however many weeks).
 */
export function scorePerSessionCommitment(
  weightPercent: number,
  sessions: readonly SessionResult[],
): CommitmentScore {
  if (sessions.length === 0) {
    return { points: fromInt(0), consistency: null };
  }
  const meanProgress = mean(sessions.map((s) => s.progress));
  const points = mul(mul(fromInt(weightPercent), WEIGHT_TO_POINTS), meanProgress);
  const reached = sessions.filter((s) => s.consistent).length;
  const consistency = div(fromInt(reached), fromInt(sessions.length));
  return { points, consistency };
}
