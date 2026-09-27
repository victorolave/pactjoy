/**
 * fast-check arbitraries for the score-bounds property test (F9). Test
 * support only — never exported from `index.ts`, imported only from
 * `*.test.ts` and `test-support/` (Q6: fast-check is a devDependency of
 * packages/engine only).
 */
import { type Arbitrary, array, constant, integer, uniqueArray } from "fast-check";
import type { Fraction } from "../fraction/fraction";
import { frac, isZero } from "../fraction/fraction";
import type { SessionResult } from "../opportunity/per-session";

const WEIGHT_STEP_PERCENT = 5;
const TOTAL_WEIGHT_PERCENT = 100;
const TOTAL_STEPS = TOTAL_WEIGHT_PERCENT / WEIGHT_STEP_PERCENT; // 20

/**
 * `count` positive integers summing to {@link TOTAL_STEPS}, via `count - 1`
 * distinct cut points (the standard "stars and bars" composition
 * technique) — the same shape `assertValidCommitments`
 * (`commitment/commitment.ts`) requires once multiplied back out by
 * {@link WEIGHT_STEP_PERCENT}.
 */
function stepsPartition(count: number): Arbitrary<readonly number[]> {
  if (count === 1) return constant([TOTAL_STEPS]);
  return uniqueArray(integer({ min: 1, max: TOTAL_STEPS - 1 }), {
    minLength: count - 1,
    maxLength: count - 1,
  }).map((cuts) => {
    const sorted = [...cuts].sort((a, b) => a - b);
    const bounds = [0, ...sorted, TOTAL_STEPS];
    const steps: number[] = [];
    for (let i = 1; i < bounds.length; i++) {
      steps.push((bounds[i] ?? 0) - (bounds[i - 1] ?? 0));
    }
    return steps;
  });
}

/**
 * `count` commitments' `weightPercent`s: each a 5%-step multiple between 5
 * and 100, summing to exactly 100 — `assertValidCommitments`'s own
 * pact-level invariant.
 */
export function weightPercentPartition(count: number): Arbitrary<readonly number[]> {
  return stepsPartition(count).map((steps) => steps.map((step) => step * WEIGHT_STEP_PERCENT));
}

/** A `Fraction` in `[0, 1]` — the domain of a `SessionResult`'s `progress` (`progressOf`'s own range). */
export function progressArbitrary(): Arbitrary<Fraction> {
  return integer({ min: 1, max: 1000 }).chain((den) =>
    integer({ min: 0, max: den }).map((num) => frac(BigInt(num), BigInt(den))),
  );
}

/**
 * A `SessionResult` honoring the real domain invariant `consistent =
 * !isZero(progress)` (`progress/progress.ts`'s `isConsistent`). `value`
 * itself never participates in `scoreCommitmentSoFar`'s arithmetic, so
 * it is always `null` here.
 */
export function sessionResultArbitrary(): Arbitrary<SessionResult> {
  return progressArbitrary().map((progress) => ({
    value: null,
    progress,
    consistent: !isZero(progress),
  }));
}

export function sessionResultsArbitrary(maxLength = 20): Arbitrary<readonly SessionResult[]> {
  return array(sessionResultArbitrary(), { minLength: 0, maxLength });
}
