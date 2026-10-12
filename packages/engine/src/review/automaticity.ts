/**
 * SRBAI scoring (the self-reported automaticity index, 1-7), pure and exact.
 *
 * - `automaticityOf`: a commitment's automaticity in one review is the exact mean of the items
 *   answered (4 items for a full review, 1 for an item-1-only review). Whether ALL required items
 *   were answered is the app's validation, not this function's: it is a pure mean.
 * - `comparableAutomaticity`: the single seam deciding whether a score counts as "improved"
 *   against a reference (35b). Today it compares the values as they are, item-1 against a full
 *   mean included (REQ-A11, a known limitation recorded in ADR-0014); judged on the ROUNDED
 *   tenths so "de 3,3 a 3,3" can never be named (REQ-A7, SC-52). A later like-for-like rule
 *   changes this one function.
 *
 * No clock, no I/O. The 1..7 bound is the scale itself, not a tunable threshold.
 */
import { automaticityTenths, displayAutomaticity } from "../display/display.ts";
import type { Fraction } from "../fraction/fraction.ts";
import { fromInt, mean } from "../fraction/fraction.ts";

const SRBAI_MIN = 1;
const SRBAI_MAX = 7;

/**
 * The exact mean of the answered SRBAI items.
 *
 * @throws {RangeError} if the list is empty or an item is not an integer in 1..7.
 */
export function automaticityOf(items: readonly number[]): Fraction {
  for (const item of items) {
    if (!Number.isInteger(item) || item < SRBAI_MIN || item > SRBAI_MAX) {
      throw new RangeError(`automaticityOf: item ${item} is not an integer in 1..7`);
    }
  }
  return mean(items.map(fromInt));
}

export interface AutomaticityComparison {
  /** Strictly higher once both sides are rounded to one decimal. */
  readonly improved: boolean;
  /** The reference, as displayed ("3,5"). */
  readonly from: string;
  /** The current score, as displayed ("4,5"). */
  readonly to: string;
}

/** Compares `current` with `reference` as they are (REQ-A11), judging on displayed tenths. */
export function comparableAutomaticity(
  current: Fraction,
  reference: Fraction,
): AutomaticityComparison {
  return {
    improved: automaticityTenths(current) > automaticityTenths(reference),
    from: displayAutomaticity(reference),
    to: displayAutomaticity(current),
  };
}
