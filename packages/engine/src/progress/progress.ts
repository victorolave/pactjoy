import type { Target } from "../commitment/commitment";
import type { Fraction } from "../fraction/fraction";
import { div, eq, fromInt, isZero, lt, lte, min, sub } from "../fraction/fraction";

const ZERO = fromInt(0);
const ONE = fromInt(1);
const TWO = fromInt(2);

/**
 * The exact progress fraction for one opportunity, in `[0, 1]`.
 *
 * `value` is `null` for both "no entry at all" and an explicit `missed`
 * entry — the two are only distinguished by the "so far" counting rule
 * (R1), never by progress: both mean "nothing achieved" here (D3).
 */
export function progressOf(target: Target, value: Fraction | null): Fraction {
  if (value === null) {
    return ZERO;
  }
  if (target.direction === "reach") {
    if (lt(value, target.minimum)) {
      return ZERO;
    }
    return min(div(value, target.ideal), ONE);
  }
  // direction === "limit"
  if (lte(value, target.ideal)) {
    return ONE;
  }
  if (eq(target.tolerance, target.ideal)) {
    // No room between ideal and tolerance: anything past ideal is also past tolerance.
    return ZERO;
  }
  if (lte(value, target.tolerance)) {
    const span = sub(target.tolerance, target.ideal);
    const excess = sub(value, target.ideal);
    return sub(ONE, div(div(excess, span), TWO));
  }
  return ZERO;
}

/**
 * Whether this opportunity counts toward consistency (D1): for `reach`,
 * the entry reached the minimum; for `limit`, the entry stayed within
 * tolerance (a `limit` target has no minimum, so a name built around
 * "minimum" doesn't fit both directions — "consistent" does). Both are
 * exactly the condition that makes progress nonzero, so this reuses
 * {@link progressOf} instead of re-deriving the threshold.
 */
export function isConsistent(target: Target, value: Fraction | null): boolean {
  return !isZero(progressOf(target, value));
}
