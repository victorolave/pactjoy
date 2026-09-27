/**
 * D10: the display layer's own rounding boundary. This module and
 * `pause/proration.ts` (D6) are the ONLY two call sites of
 * `fraction.ts`'s `roundHalfUp` in the whole engine (ADR-0006, spec
 * `exact-arithmetic`) — nothing else rounds before this point. Points,
 * progress and averages stay exact `Fraction`s everywhere else; a UI only
 * ever sees the rounded `number` these two functions produce.
 */
import type { Fraction } from "../fraction/fraction";
import { fromInt, mul, roundHalfUp } from "../fraction/fraction";

const HUNDRED = fromInt(100);

/**
 * Rounds an exact points `Fraction` half-up to a whole point for display.
 * A member's `points` is always `0 <= points <= 1000` (the score bounds
 * invariant, spec `exact-arithmetic`), so the result is always `<= 1000`.
 */
export function displayPoints(f: Fraction): number {
  return Number(roundHalfUp(f));
}

/**
 * Scales a `[0, 1]` progress fraction to a rounded whole percent for
 * display (e.g. `consistency`/`idealCompletion`). Rounding happens on the
 * SCALED fraction (`f * 100`), never on `f` first then multiplied — the
 * same single-rounding-boundary rule the exact-arithmetic spec requires.
 */
export function displayPercent(f: Fraction): number {
  return Number(roundHalfUp(mul(f, HUNDRED)));
}
