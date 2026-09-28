/**
 * Per-commitment score: points, consistency and idealCompletion (D1/D12/R7)
 * from two flat lists of already-generated `SessionResult`s (pause-aware,
 * across however many weeks — `scoring/member-score.ts` is the caller that
 * generates both lists for a whole season).
 */
import type { Fraction } from "../fraction/fraction.ts";
import { div, fromInt, mul, sum } from "../fraction/fraction.ts";
import type { SessionResult } from "../opportunity/per-session.ts";

export interface CommitmentScore {
  /**
   * D12: `weight x 1000 x (sum of progress counted so far) / (every active
   * opportunity of the whole season)`. Redistributes over the SEASON's own
   * denominator regardless of how much has been counted yet — R7 does NOT
   * change this. `0` with zero opportunities counted so far (R6).
   */
  readonly points: Fraction;
  /**
   * R7 (decision round 4, binding): `reached / (opportunities counted so
   * far)` — NOT the whole season's opportunity count. `null` with zero
   * counted opportunities (R6) — not `0`.
   */
  readonly consistency: Fraction | null;
  /**
   * R7: `mean(progress of the opportunities counted so far)` — a distinct
   * metric from `consistency` (a session can be "consistent" without
   * reaching full progress). **`idealCompletion = points / potential` only
   * holds at season end** (when every opportunity has been counted, so the
   * "so far" and "whole season" denominators coincide) — mid-season the two
   * metrics use deliberately different denominators (R7: points redistribute
   * over the season; consistency/idealCompletion reflect only what's been
   * counted). `null` with zero counted opportunities (R6) — not `0`.
   */
  readonly idealCompletion: Fraction | null;
}

const WEIGHT_TO_POINTS = fromInt(10); // weightPercent (0-100) x 10 = weight x 1000

/**
 * D12 mid-season recompute + R7 (mid-season consistency/idealCompletion,
 * decision round 4, binding): `allSessions` is the whole season's
 * pause-aware active opportunities (as of `today`, unaffected by R1) —
 * `points`'s own denominator, exactly matching Mecanicas' "valor de cada
 * oportunidad = potencial / oportunidades activas de la temporada."
 * `soFarSessions` (a subset of `allSessions`, R1-gated by the caller —
 * `scoring/member-score.ts`) drives EVERY numerator, AND (R7) is also
 * `consistency`/`idealCompletion`'s own denominator — unlike `points`, which
 * keeps dividing by the whole season. At season end (`soFarSessions ===
 * allSessions`), every value reduces to exactly the pre-R7/pre-6b
 * mean-based formula — backward-compatible by construction.
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
  // D12: points redistribute over the WHOLE season's active opportunities -- unaffected by R7.
  const points = mul(potential, div(progressSoFar, fromInt(allSessions.length)));
  // R7: consistency/idealCompletion are computed ONLY over what's counted so far.
  const reached = soFarSessions.filter((s) => s.consistent).length;
  const consistency = div(fromInt(reached), fromInt(soFarSessions.length));
  const idealCompletion = div(progressSoFar, fromInt(soFarSessions.length));
  return { points, consistency, idealCompletion };
}
