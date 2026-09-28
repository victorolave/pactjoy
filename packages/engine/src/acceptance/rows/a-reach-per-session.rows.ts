import type { Target } from "../../commitment/commitment.ts";
import type { Fraction } from "../../fraction/fraction.ts";
import { fromInt, parseDecimal } from "../../fraction/fraction.ts";
import { sumEntryValues } from "../../opportunity/per-session.ts";
import { buildQuantityEntry } from "../../test-support/builders.ts";
import { fr } from "../../test-support/fraction-literal.ts";

export interface ProgressRow {
  readonly id: string;
  readonly summary: string;
  readonly target: Target;
  readonly value: Fraction | null;
  readonly expectedProgress: Fraction;
  readonly expectedConsistent: boolean;
}

/** reach/perSession, minimum 10, ideal 30 (e.g. minutes of reading). */
const withMinimumBelowIdeal: Target = {
  direction: "reach",
  minimum: fromInt(10),
  ideal: fromInt(30),
};

/** A boolean (`done`) commitment's implicit target: minimum = ideal = 1. */
const booleanTarget: Target = { direction: "reach", minimum: fromInt(1), ideal: fromInt(1) };

/** reach/perSession where minimum = ideal (all-or-nothing), e.g. pages. */
const allOrNothingTarget: Target = { direction: "reach", minimum: fromInt(20), ideal: fromInt(20) };

/**
 * Series A: `reach` direction, `perSession` period. A12 exercises D4's
 * same-day entry summation (`sumEntryValues`, slice 3).
 */
export const aReachPerSessionRows: readonly ProgressRow[] = [
  {
    id: "A1",
    summary: "no entry gives zero progress",
    target: withMinimumBelowIdeal,
    value: null,
    expectedProgress: fr("0"),
    expectedConsistent: false,
  },
  {
    id: "A2",
    summary: "an entry below the minimum gives zero progress",
    target: withMinimumBelowIdeal,
    value: parseDecimal("5"),
    expectedProgress: fr("0"),
    expectedConsistent: false,
  },
  {
    id: "A3",
    summary: "an entry just below the minimum still gives zero (boundary)",
    target: withMinimumBelowIdeal,
    value: parseDecimal("9"),
    expectedProgress: fr("0"),
    expectedConsistent: false,
  },
  {
    id: "A4",
    summary: "an entry exactly at the minimum counts: the minimum is a threshold, not a flat base",
    target: withMinimumBelowIdeal,
    value: parseDecimal("10"),
    expectedProgress: fr("1/3"),
    expectedConsistent: true,
  },
  {
    id: "A5",
    summary: "an entry between the minimum and the ideal is proportional to the ideal",
    target: withMinimumBelowIdeal,
    value: parseDecimal("20"),
    expectedProgress: fr("2/3"),
    expectedConsistent: true,
  },
  {
    id: "A6",
    summary: "an entry exactly at the ideal gives full progress",
    target: withMinimumBelowIdeal,
    value: parseDecimal("30"),
    expectedProgress: fr("1"),
    expectedConsistent: true,
  },
  {
    id: "A7",
    summary: "an entry beyond the ideal is capped at full progress, never exceeds it",
    target: withMinimumBelowIdeal,
    value: parseDecimal("60"),
    expectedProgress: fr("1"),
    expectedConsistent: true,
  },
  {
    id: "A8",
    summary: "a completed boolean (done) commitment gives full progress",
    target: booleanTarget,
    value: fromInt(1),
    expectedProgress: fr("1"),
    expectedConsistent: true,
  },
  {
    id: "A9",
    summary: "an incomplete boolean (not done) commitment gives zero progress",
    target: booleanTarget,
    value: null,
    expectedProgress: fr("0"),
    expectedConsistent: false,
  },
  {
    id: "A10",
    summary: "when minimum equals ideal, anything below it is all-or-nothing zero",
    target: allOrNothingTarget,
    value: parseDecimal("19"),
    expectedProgress: fr("0"),
    expectedConsistent: false,
  },
  {
    id: "A11",
    summary: "when minimum equals ideal, reaching it is all-or-nothing full progress",
    target: allOrNothingTarget,
    value: parseDecimal("20"),
    expectedProgress: fr("1"),
    expectedConsistent: true,
  },
  {
    id: "A12",
    summary: "entries on the same day sum into one session before evaluating progress (D4)",
    target: withMinimumBelowIdeal,
    value: sumEntryValues([
      buildQuantityEntry("read", 0, parseDecimal("10")),
      buildQuantityEntry("read", 0, parseDecimal("15")),
    ]),
    expectedProgress: fr("5/6"),
    expectedConsistent: true,
  },
];
