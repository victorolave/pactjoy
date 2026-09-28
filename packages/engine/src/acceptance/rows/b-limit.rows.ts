import type { Target } from "../../commitment/commitment.ts";
import { fromInt, parseDecimal } from "../../fraction/fraction.ts";
import { fr } from "../../test-support/fraction-literal.ts";
import type { ProgressRow } from "./a-reach-per-session.rows.ts";

/** limit/perSession, ideal 2, tolerance 4 (e.g. cups of coffee). */
const withGapBetweenIdealAndTolerance: Target = {
  direction: "limit",
  ideal: fromInt(2),
  tolerance: fromInt(4),
};

/** limit/perSession, ideal 0, tolerance 2 (e.g. cigarettes — zero is the ideal). */
const withZeroIdeal: Target = { direction: "limit", ideal: fromInt(0), tolerance: fromInt(2) };

/** limit/perSession, ideal 1, tolerance 2, continuous unit (e.g. hours of screen time). */
const withContinuousUnit: Target = { direction: "limit", ideal: fromInt(1), tolerance: fromInt(2) };

/** limit/perSession where ideal = tolerance (no linear segment at all). */
const withNoGap: Target = { direction: "limit", ideal: fromInt(2), tolerance: fromInt(2) };

/** Series B: `limit` direction, `perSession` period. */
export const bLimitRows: readonly ProgressRow[] = [
  {
    id: "B1",
    summary: "an entry below the ideal is also full progress (less is only ever better)",
    target: withGapBetweenIdealAndTolerance,
    value: fromInt(0),
    expectedProgress: fr("1"),
    expectedConsistent: true,
  },
  {
    id: "B2",
    summary: "an entry exactly at the ideal gives full progress",
    target: withGapBetweenIdealAndTolerance,
    value: parseDecimal("2"),
    expectedProgress: fr("1"),
    expectedConsistent: true,
  },
  {
    id: "B3",
    summary: "an entry partway between ideal and tolerance gives partial progress",
    target: withGapBetweenIdealAndTolerance,
    value: parseDecimal("3"),
    expectedProgress: fr("3/4"),
    expectedConsistent: true,
  },
  {
    id: "B4",
    summary: "an entry exactly at the tolerance gives exactly half progress",
    target: withGapBetweenIdealAndTolerance,
    value: parseDecimal("4"),
    expectedProgress: fr("1/2"),
    expectedConsistent: true,
  },
  {
    id: "B5",
    summary: "an entry beyond the tolerance gives zero progress",
    target: withGapBetweenIdealAndTolerance,
    value: parseDecimal("5"),
    expectedProgress: fr("0"),
    expectedConsistent: false,
  },
  {
    id: "B6",
    summary: "no entry gives zero progress (D3), even for a limit direction",
    target: withGapBetweenIdealAndTolerance,
    value: null,
    expectedProgress: fr("0"),
    expectedConsistent: false,
  },
  {
    id: "B7",
    summary:
      "an explicitly recorded zero at a zero ideal gives full progress (the zero must be recorded, not just absent)",
    target: withZeroIdeal,
    value: fromInt(0),
    expectedProgress: fr("1"),
    expectedConsistent: true,
  },
  {
    id: "B8",
    summary: "an entry partway to the tolerance from a zero ideal gives partial progress",
    target: withZeroIdeal,
    value: parseDecimal("1"),
    expectedProgress: fr("3/4"),
    expectedConsistent: true,
  },
  {
    id: "B9",
    summary: "an entry exactly at the tolerance from a zero ideal gives exactly half progress",
    target: withZeroIdeal,
    value: parseDecimal("2"),
    expectedProgress: fr("1/2"),
    expectedConsistent: true,
  },
  {
    id: "B10",
    summary: "an entry beyond the tolerance from a zero ideal gives zero progress",
    target: withZeroIdeal,
    value: parseDecimal("3"),
    expectedProgress: fr("0"),
    expectedConsistent: false,
  },
  {
    id: "B11",
    summary: "no entry gives zero progress even when the ideal is already zero",
    target: withZeroIdeal,
    value: null,
    expectedProgress: fr("0"),
    expectedConsistent: false,
  },
  {
    id: "B12",
    summary: "a continuous (non-integer) entry between ideal and tolerance gives partial progress",
    target: withContinuousUnit,
    value: parseDecimal("1.5"),
    expectedProgress: fr("3/4"),
    expectedConsistent: true,
  },
  {
    id: "B13",
    summary:
      "when ideal equals tolerance, an entry at that exact value gives full progress by segment membership",
    target: withNoGap,
    value: parseDecimal("2"),
    expectedProgress: fr("1"),
    expectedConsistent: true,
  },
  {
    id: "B14",
    summary:
      "when ideal equals tolerance, any entry above it gives zero progress with no division by zero",
    target: withNoGap,
    value: parseDecimal("3"),
    expectedProgress: fr("0"),
    expectedConsistent: false,
  },
];
