import type { Frequency, QuantityUnit, Schedule } from "@pactjoy/engine";
import {
  type Fraction,
  isLimitIdealWithinTolerance,
  isPositiveReachMinimum,
  isReachMinimumWithinIdeal,
  isValidWeightPercent,
  parseDecimal,
} from "@pactjoy/engine";
import { err, ok, type Result } from "../shared/result.ts";
import { MAX_CUSTOM_LABEL_LENGTH, type Measure } from "./commitment.ts";

/**
 * Raw, not-yet-validated shape for one commitment's measure -- decimal
 * thresholds are plain strings (A12: at most 2 decimals, parsed via the
 * engine's `parseDecimal`, never a `float`, D10). `done` mirrors
 * `commitment.ts`'s `Measure`: it carries only a `frequency`, which is
 * exactly how SS-7 ("done" is always reach + perSession) is enforced at
 * the type level -- there is no `direction`/`target` field to even
 * mis-supply.
 */
export type MeasureInput =
  | { readonly unit: "done"; readonly frequency: Frequency }
  | {
      readonly unit: QuantityUnit;
      readonly customLabel?: string | null;
      readonly direction: "reach";
      readonly minimum: string;
      readonly ideal: string;
      readonly schedule: Schedule;
    }
  | {
      readonly unit: QuantityUnit;
      readonly customLabel?: string | null;
      readonly direction: "limit";
      readonly ideal: string;
      readonly tolerance: string;
      readonly schedule: Schedule;
    };

export interface ValidateCommitmentInput {
  readonly weightPercent: number;
  readonly measure: MeasureInput;
}

export type ValidateCommitmentError =
  | { readonly kind: "InvalidWeight" }
  | { readonly kind: "InvalidQuantity"; readonly field: "minimum" | "ideal" | "tolerance" }
  | { readonly kind: "MinimumNotPositive" }
  | { readonly kind: "MinimumExceedsIdeal" }
  | { readonly kind: "IdealExceedsTolerance" }
  | { readonly kind: "CustomLabelTooLong" };

// A12: at most 2 decimal places, non-negative (thresholds are always
// physical quantities >= 0). `parseDecimal` itself accepts any number of
// decimal digits (and a leading "-"), so both the decimal-place cap AND
// the non-negativity of every threshold this module ever builds are
// enforced here, before handing the string to it -- which is also why
// there is no separate "ideal >= 0" check below (unlike the engine's own
// `assertValidTarget`, which validates already-built `Fraction`s that
// could in principle be negative): a `Fraction` produced by this regex can
// never be negative in the first place.
const AT_MOST_TWO_DECIMALS = /^\d+(\.\d{1,2})?$/;

function parseQuantity(raw: string): Fraction | null {
  if (!AT_MOST_TWO_DECIMALS.test(raw)) {
    return null;
  }
  return parseDecimal(raw);
}

/**
 * Validates ONE commitment's own shape (SS-7..SS-12): weight step/range,
 * reach's `0 < minimum <= ideal` (A12, SS-8/SS-9), limit's
 * `0 <= ideal <= tolerance`, quantity decimal precision (SS-10) and custom
 * label length (SS-11). Deliberately does NOT check the pact-level
 * "weights sum to 100%" invariant -- that's only enforced when a member
 * approves the pact (B5, S6's `approve-pact.ts`), not on every edit here.
 *
 * The weight and reach/limit numeric invariants themselves are NOT
 * re-implemented here (fresh-review fix, single source of truth): they
 * call the engine's own non-throwing predicates
 * (`isValidWeightPercent`/`isPositiveReachMinimum`/
 * `isReachMinimumWithinIdeal`/`isLimitIdealWithinTolerance`, the same ones
 * `assertValidTarget`/`assertValidCommitments` are built on). This module
 * only owns the app-specific rules the engine has no opinion on: decimal
 * precision (SS-10), custom label length (SS-11), and turning each
 * violation into its own granular `Result` error instead of one thrown
 * `RangeError`.
 *
 * Returns the parsed {@link Measure} on success so callers never re-parse
 * the same decimal strings (same split as `buildCircle`/`buildHabit`/
 * `buildSeason`: validate once, hand back an already-valid value).
 */
export function validateCommitment(
  input: ValidateCommitmentInput,
): Result<Measure, ValidateCommitmentError> {
  if (!isValidWeightPercent(input.weightPercent)) {
    return err({ kind: "InvalidWeight" });
  }

  const { measure } = input;
  if (measure.unit === "done") {
    return ok({
      unit: "done",
      schedule: { period: "perSession", frequency: measure.frequency },
    });
  }

  if (measure.customLabel != null && measure.customLabel.length > MAX_CUSTOM_LABEL_LENGTH) {
    return err({ kind: "CustomLabelTooLong" });
  }

  if (measure.direction === "reach") {
    const minimum = parseQuantity(measure.minimum);
    if (!minimum) {
      return err({ kind: "InvalidQuantity", field: "minimum" });
    }
    const ideal = parseQuantity(measure.ideal);
    if (!ideal) {
      return err({ kind: "InvalidQuantity", field: "ideal" });
    }
    if (!isPositiveReachMinimum(minimum)) {
      return err({ kind: "MinimumNotPositive" });
    }
    if (!isReachMinimumWithinIdeal(minimum, ideal)) {
      return err({ kind: "MinimumExceedsIdeal" });
    }
    return ok({
      unit: measure.unit,
      customLabel: measure.customLabel ?? null,
      target: { direction: "reach", minimum, ideal },
      schedule: measure.schedule,
    });
  }

  // direction === "limit"
  const ideal = parseQuantity(measure.ideal);
  if (!ideal) {
    return err({ kind: "InvalidQuantity", field: "ideal" });
  }
  const tolerance = parseQuantity(measure.tolerance);
  if (!tolerance) {
    return err({ kind: "InvalidQuantity", field: "tolerance" });
  }
  // No "ideal >= 0" re-check here (unlike the engine's `assertValidTarget`):
  // `parseQuantity`'s regex already rejects a leading "-", so `ideal` can
  // never be negative at this point -- see this module's `parseQuantity`
  // docstring above.
  if (!isLimitIdealWithinTolerance(ideal, tolerance)) {
    return err({ kind: "IdealExceedsTolerance" });
  }
  return ok({
    unit: measure.unit,
    customLabel: measure.customLabel ?? null,
    target: { direction: "limit", ideal, tolerance },
    schedule: measure.schedule,
  });
}
