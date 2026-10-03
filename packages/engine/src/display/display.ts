/**
 * D10: the display layer's own rounding boundary. This module and
 * `pause/proration.ts` (D6) are the ONLY two call sites of
 * `fraction.ts`'s `roundHalfUp` in the whole engine (ADR-0006, spec
 * `exact-arithmetic`) — nothing else rounds before this point. Points,
 * progress and averages stay exact `Fraction`s everywhere else; a UI only
 * ever sees the rounded `number` these two functions produce.
 */
import type { Fraction } from "../fraction/fraction.ts";
import { fromInt, mul, roundHalfUp } from "../fraction/fraction.ts";

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

/**
 * Rounds an exact points `Fraction` half-up to two decimals, as the shortest
 * decimal string ("6.25", "8", "2.5"). For what one opportunity is worth,
 * which is a fraction of a point, where a whole number would lose the detail
 * a client needs to preview a draft. Same single rounding boundary (D10).
 */
export function displayPointsDecimal(f: Fraction): string {
  const hundredths = roundHalfUp(mul(f, HUNDRED));
  const whole = hundredths / 100n;
  const cents = (hundredths % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return cents === "" ? whole.toString() : `${whole}.${cents}`;
}
