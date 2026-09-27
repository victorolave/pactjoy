/**
 * Per-commitment score: points, consistency and idealCompletion (D1) from a
 * flat list of already-generated `SessionResult`s (pause-aware, across
 * however many weeks — `scoring/member-score.ts` is the caller that
 * generates that list for a whole season).
 */
import type { Fraction } from "../fraction/fraction";
import { div, fromInt, mul, sum } from "../fraction/fraction";
import type { SessionResult } from "../opportunity/per-session";

export interface CommitmentScore {
  /** weightPercent x 1000 x mean(progress of every opportunity). 0 with zero opportunities (R6). */
  readonly points: Fraction;
  /** reached/total. `null` with zero counted opportunities (R6) — not `0`. */
  readonly consistency: Fraction | null;
  /**
   * D1: mean(progress of every opportunity) = points / potential — a
   * distinct metric from `consistency` (a session can be "consistent"
   * without reaching full progress). `null` with zero counted opportunities
   * (R6) — not `0`.
   */
  readonly idealCompletion: Fraction | null;
}

const WEIGHT_TO_POINTS = fromInt(10); // weightPercent (0-100) x 10 = weight x 1000

/**
 * Aggregates one commitment's `perSession` week(s) into points, consistency
 * and idealCompletion. `sessions` is the flat list of every opportunity
 * generated for this commitment so far (across however many weeks).
 */
export function scorePerSessionCommitment(
  weightPercent: number,
  sessions: readonly SessionResult[],
): CommitmentScore {
  return scoreCommitmentSoFar(weightPercent, sessions, sessions);
}

/**
 * D12 mid-season recompute: `allSessions` is the whole season's pause-aware
 * active opportunities (as of `today`, unaffected by R1) — the denominator,
 * exactly matching Mecanicas' "valor de cada oportunidad = potencial /
 * oportunidades activas de la temporada." `soFarSessions` (a subset of
 * `allSessions`, R1-gated by the caller — `scoring/member-score.ts`) drives
 * the numerator: only opportunities already counted "so far" contribute
 * their progress. At season end (when every opportunity has been counted,
 * `soFarSessions === allSessions`), this reduces to exactly
 * {@link scorePerSessionCommitment}'s own mean-based formula — the two
 * functions are backward-compatible by construction, not by coincidence.
 *
 * R6: nothing counted so far yet (`soFarSessions.length === 0`, e.g. day 0
 * of the season, or every opportunity still paused/on-hold) -> `points = 0`,
 * `consistency`/`idealCompletion = null`. This subsumes the zero-opportunity
 * case entirely, since `soFarSessions` is always a subset of `allSessions`.
 */
export function scoreCommitmentSoFar(
  weightPercent: number,
  allSessions: readonly SessionResult[],
  soFarSessions: readonly SessionResult[],
): CommitmentScore {
  if (soFarSessions.length === 0) {
    return { points: fromInt(0), consistency: null, idealCompletion: null };
  }
  const potential = mul(fromInt(weightPercent), WEIGHT_TO_POINTS);
  const progressSoFar = sum(soFarSessions.map((s) => s.progress));
  const idealCompletion = div(progressSoFar, fromInt(allSessions.length));
  const points = mul(potential, idealCompletion);
  const reached = soFarSessions.filter((s) => s.consistent).length;
  const consistency = div(fromInt(reached), fromInt(allSessions.length));
  return { points, consistency, idealCompletion };
}
