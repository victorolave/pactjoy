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
import {
  MAX_CUSTOM_LABEL_LENGTH,
  MAX_INTEGER_DIGITS,
  type Measure,
  precisionOfUnit,
  type QuantityPrecision,
} from "./commitment.ts";

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
      /**
       * Chosen by `custom` units (default `decimal`). A built-in unit has a fixed precision:
       * it may restate it, but a conflicting value is `PrecisionNotApplicable`.
       */
      readonly precision?: QuantityPrecision;
      readonly direction: "reach";
      readonly minimum: string;
      readonly ideal: string;
      readonly schedule: Schedule;
    }
  | {
      readonly unit: QuantityUnit;
      readonly customLabel?: string | null;
      /**
       * Chosen by `custom` units (default `decimal`). A built-in unit has a fixed precision:
       * it may restate it, but a conflicting value is `PrecisionNotApplicable`.
       */
      readonly precision?: QuantityPrecision;
      readonly direction: "limit";
      readonly ideal: string;
      readonly tolerance: string;
      readonly schedule: Schedule;
    };

export interface ValidateCommitmentInput {
  readonly weightPercent: number;
  readonly measure: MeasureInput;
}

type ThresholdField = "minimum" | "ideal" | "tolerance";

export type ValidateCommitmentError =
  | { readonly kind: "InvalidWeight" }
  | { readonly kind: "InvalidQuantity"; readonly field: ThresholdField }
  | { readonly kind: "IntegerRequired"; readonly field: ThresholdField }
  | { readonly kind: "MinimumNotPositive" }
  | { readonly kind: "MinimumExceedsIdeal" }
  | { readonly kind: "IdealExceedsTolerance" }
  | { readonly kind: "CustomLabelTooLong" }
  | { readonly kind: "CustomLabelHasInvisibleCharacters" }
  | { readonly kind: "CustomLabelBlank" }
  | { readonly kind: "InvalidTimesPerWeek" }
  | { readonly kind: "NoWeekdays" }
  | { readonly kind: "DuplicateWeekday" }
  | { readonly kind: "InvalidWeekday" }
  | { readonly kind: "InvalidPrecision" }
  | { readonly kind: "PrecisionNotApplicable" };

const PRECISIONS: readonly QuantityPrecision[] = ["integer", "decimal"];

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

const WHOLE_NUMBER = /^\d+$/;

// Characters a reader cannot see or that break layout: control (Cc, NUL included:
// Postgres jsonb rejects it), format (Cf: zero-width, BOM, bidi overrides) and
// line/paragraph separators (Zl, Zp). Other circle members see the label, so
// invisible characters would enable spoofing.
const INVISIBLE_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

const MIN_TIMES_PER_WEEK = 1;
const MAX_TIMES_PER_WEEK = 7;
const MAX_WEEKDAY = 6;

/**
 * User decision 2026-09-30: `timesPerWeek` is an integer 1..7;
 * `specificDays` is a non-empty list of distinct integer weekdays 0..6
 * (Monday = 0). Returns the error to report, or `null` when valid.
 */
function frequencyError(frequency: Frequency): ValidateCommitmentError | null {
  if (frequency.kind === "timesPerWeek") {
    const { times } = frequency;
    return Number.isInteger(times) && times >= MIN_TIMES_PER_WEEK && times <= MAX_TIMES_PER_WEEK
      ? null
      : { kind: "InvalidTimesPerWeek" };
  }
  const { weekdays } = frequency;
  if (weekdays.length === 0) {
    return { kind: "NoWeekdays" };
  }
  if (!weekdays.every((day) => Number.isInteger(day) && day >= 0 && day <= MAX_WEEKDAY)) {
    return { kind: "InvalidWeekday" };
  }
  if (new Set(weekdays).size !== weekdays.length) {
    return { kind: "DuplicateWeekday" };
  }
  return null;
}

function scheduleError(schedule: Schedule): ValidateCommitmentError | null {
  return schedule.period === "perSession" ? frequencyError(schedule.frequency) : null;
}

/**
 * Parses one threshold. On an integer-precision unit only plain digits are
 * accepted (even "2.0" is rejected, same rule as entry values), reported
 * as `IntegerRequired` rather than a generic `InvalidQuantity`.
 */
function parseThreshold(
  raw: string,
  field: ThresholdField,
  precision: QuantityPrecision,
): Result<Fraction, ValidateCommitmentError> {
  if (!AT_MOST_TWO_DECIMALS.test(raw)) {
    return err({ kind: "InvalidQuantity", field });
  }
  // Same cap as entry values; leading zeros don't count.
  const integerPart = raw.split(".")[0] ?? "";
  if (integerPart.replace(/^0+/, "").length > MAX_INTEGER_DIGITS) {
    return err({ kind: "InvalidQuantity", field });
  }
  if (precision === "integer" && !WHOLE_NUMBER.test(raw)) {
    return err({ kind: "IntegerRequired", field });
  }
  return ok(parseDecimal(raw));
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
    const invalidFrequency = frequencyError(measure.frequency);
    if (invalidFrequency) {
      return err(invalidFrequency);
    }
    return ok({
      unit: "done",
      schedule: { period: "perSession", frequency: measure.frequency },
    });
  }

  if (measure.customLabel != null && measure.customLabel.length > MAX_CUSTOM_LABEL_LENGTH) {
    return err({ kind: "CustomLabelTooLong" });
  }
  if (measure.customLabel != null && INVISIBLE_CHARACTER.test(measure.customLabel)) {
    return err({ kind: "CustomLabelHasInvisibleCharacters" });
  }
  // `null`/absent means "no label" and is untouched; a supplied label must show something.
  if (measure.customLabel != null && measure.customLabel.trim() === "") {
    return err({ kind: "CustomLabelBlank" });
  }
  const invalidSchedule = scheduleError(measure.schedule);
  if (invalidSchedule) {
    return err(invalidSchedule);
  }

  // `precision` only means something for `custom` units (a built-in unit's
  // precision is fixed), but the type can't say so cleanly: a built-in unit
  // may still restate its own value, so this is a runtime rule (the HTTP
  // adapter builds the input from arbitrary JSON anyway).
  if (measure.precision !== undefined && !PRECISIONS.includes(measure.precision)) {
    return err({ kind: "InvalidPrecision" });
  }
  const unitPrecision = precisionOfUnit(measure.unit);
  if (
    unitPrecision !== null &&
    measure.precision !== undefined &&
    measure.precision !== unitPrecision
  ) {
    return err({ kind: "PrecisionNotApplicable" });
  }
  const precision = unitPrecision ?? measure.precision ?? "decimal";

  if (measure.direction === "reach") {
    const minimumResult = parseThreshold(measure.minimum, "minimum", precision);
    if (!minimumResult.ok) {
      return minimumResult;
    }
    const idealResult = parseThreshold(measure.ideal, "ideal", precision);
    if (!idealResult.ok) {
      return idealResult;
    }
    const minimum = minimumResult.value;
    const ideal = idealResult.value;
    if (!isPositiveReachMinimum(minimum)) {
      return err({ kind: "MinimumNotPositive" });
    }
    if (!isReachMinimumWithinIdeal(minimum, ideal)) {
      return err({ kind: "MinimumExceedsIdeal" });
    }
    return ok({
      unit: measure.unit,
      customLabel: measure.customLabel ?? null,
      precision,
      target: { direction: "reach", minimum, ideal },
      schedule: measure.schedule,
    });
  }

  // direction === "limit"
  const idealResult = parseThreshold(measure.ideal, "ideal", precision);
  if (!idealResult.ok) {
    return idealResult;
  }
  const toleranceResult = parseThreshold(measure.tolerance, "tolerance", precision);
  if (!toleranceResult.ok) {
    return toleranceResult;
  }
  const ideal = idealResult.value;
  const tolerance = toleranceResult.value;
  // No "ideal >= 0" re-check here (unlike the engine's `assertValidTarget`):
  // `parseThreshold`'s regex already rejects a leading "-", so `ideal` can
  // never be negative at this point -- see the regex's comment above.
  if (!isLimitIdealWithinTolerance(ideal, tolerance)) {
    return err({ kind: "IdealExceedsTolerance" });
  }
  return ok({
    unit: measure.unit,
    customLabel: measure.customLabel ?? null,
    precision,
    target: { direction: "limit", ideal, tolerance },
    schedule: measure.schedule,
  });
}
