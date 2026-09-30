import { type Fraction, parseDecimal } from "@pactjoy/engine";
import type { Measure } from "../commitment/commitment.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { EntryValue, EntryValueInput } from "./entry.ts";

export type EntryValueError =
  | { readonly kind: "MissedNotAllowed"; readonly reason: "limitDirection" | "weekBound" }
  | { readonly kind: "ValueKindMismatch" }
  | {
      readonly kind: "InvalidQuantity";
      readonly reason: "negative" | "tooManyDecimals" | "notANumber";
    };

const NON_NEGATIVE_DECIMAL = /^\d+(\.\d+)?$/;
const AT_MOST_TWO_DECIMALS = /^\d+(\.\d{1,2})?$/;

function parseQuantity(raw: string): Result<Fraction, EntryValueError> {
  if (raw.startsWith("-") && NON_NEGATIVE_DECIMAL.test(raw.slice(1))) {
    return err({ kind: "InvalidQuantity", reason: "negative" });
  }
  if (!NON_NEGATIVE_DECIMAL.test(raw)) {
    return err({ kind: "InvalidQuantity", reason: "notANumber" });
  }
  if (!AT_MOST_TWO_DECIMALS.test(raw)) {
    return err({ kind: "InvalidQuantity", reason: "tooManyDecimals" });
  }
  return ok(parseDecimal(raw));
}

/**
 * A8 (corrected): `missed` ("Hoy no salio") exists only for reach,
 * day-bound commitments (`specificDays`; "daily" is all 7 weekdays). Limit
 * commitments never use it -- the member logs the real value, including an
 * explicit 0, because no entry scores 0 (ER-19). `timesPerWeek` and
 * `weeklyTotal` are week-bound, so `missed` is rejected there too.
 */
function validateMissed(measure: Measure): Result<EntryValue, EntryValueError> {
  if (measure.unit !== "done" && measure.target.direction === "limit") {
    return err({ kind: "MissedNotAllowed", reason: "limitDirection" });
  }
  const { schedule } = measure;
  if (schedule.period !== "perSession" || schedule.frequency.kind !== "specificDays") {
    return err({ kind: "MissedNotAllowed", reason: "weekBound" });
  }
  return ok({ kind: "missed" });
}

/**
 * Checks that `raw` fits `measure` (A8 corrected, A12, D13, B10) and parses
 * a quantity exactly. A quantity above the ideal is kept as entered (ER-17,
 * the engine caps progress); 0 is a valid quantity on reach (B10, the only
 * way to record "nothing" on a week-bound commitment) and on limit (ER-20).
 */
export function validateEntryValue(
  measure: Measure,
  raw: EntryValueInput,
): Result<EntryValue, EntryValueError> {
  if (raw.kind === "missed") {
    return validateMissed(measure);
  }
  if (raw.kind === "done") {
    return measure.unit === "done" ? ok({ kind: "done" }) : err({ kind: "ValueKindMismatch" });
  }
  if (measure.unit === "done") {
    return err({ kind: "ValueKindMismatch" });
  }
  const parsed = parseQuantity(raw.value);
  return parsed.ok ? ok({ kind: "quantity", value: parsed.value }) : parsed;
}
