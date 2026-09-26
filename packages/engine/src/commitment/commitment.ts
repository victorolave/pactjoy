import type { Weekday } from "../calendar/season-calendar";
import type { Fraction } from "../fraction/fraction";
import { fromInt, gt, gte, lte } from "../fraction/fraction";

export type Direction = "reach" | "limit";

export type QuantityUnit = "minutes" | "hours" | "times" | "pages" | "km" | "glasses" | "custom";

export type Unit = "done" | QuantityUnit;

/**
 * The threshold shape for one commitment. `reach`: `0 < minimum ≤ ideal`.
 * `limit`: `0 ≤ ideal ≤ tolerance`. Enforced at runtime by {@link assertValidTarget}.
 */
export type Target =
  | { readonly direction: "reach"; readonly minimum: Fraction; readonly ideal: Fraction }
  | { readonly direction: "limit"; readonly ideal: Fraction; readonly tolerance: Fraction };

export type Frequency =
  | { readonly kind: "timesPerWeek"; readonly times: number }
  | { readonly kind: "specificDays"; readonly weekdays: readonly Weekday[] };

export type PerSessionSchedule = { readonly period: "perSession"; readonly frequency: Frequency };

export type Schedule = PerSessionSchedule | { readonly period: "weeklyTotal" };

export type CommitmentId = string & { readonly __brand: "CommitmentId" };

interface CommitmentBase {
  readonly id: CommitmentId;
  /**
   * Percent of the member's 1000 points, 5..100 in steps of 5. Validated by
   * {@link assertValidCommitments}. A plain `number`, not a `Fraction`, is
   * fine here: it's a small validated integer, never itself a scoring value —
   * it's converted to a `Fraction` (`weight × 1000`) before any math touches it.
   */
  readonly weightPercent: number;
}

/**
 * R3: `done` is only ever valid with `reach` + `perSession`. This is enforced
 * at the type level by construction — `schedule` here is `PerSessionSchedule`
 * specifically, not the broader `Schedule` union, so `{ unit: "done",
 * schedule: { period: "weeklyTotal" } }` cannot type-check as a `Commitment`.
 * See `type-tests/commitment.type-test.ts`.
 */
export type DoneCommitment = CommitmentBase & {
  readonly unit: "done";
  readonly schedule: PerSessionSchedule;
};

export type QuantityCommitment = CommitmentBase & {
  readonly unit: QuantityUnit;
  readonly target: Target;
  readonly schedule: Schedule;
};

export type Commitment = DoneCommitment | QuantityCommitment;

/** The implicit target for a `done` commitment: minimum and ideal both 1 (all-or-nothing). */
export function targetOf(_done: DoneCommitment): Target {
  return { direction: "reach", minimum: fromInt(1), ideal: fromInt(1) };
}

const ZERO = fromInt(0);

/**
 * Validates a {@link Target}'s numeric invariant: `reach` requires
 * `0 < minimum ≤ ideal`; `limit` requires `0 ≤ ideal ≤ tolerance`. This is
 * the single validation point for `Target` — `progressOf`/`isConsistent`
 * (in `progress.ts`) assume an already-valid target and never re-check it.
 *
 * @throws {RangeError} on any violation, with the offending values in the message.
 */
export function assertValidTarget(target: Target): void {
  if (target.direction === "reach") {
    if (!gt(target.minimum, ZERO)) {
      throw new RangeError(
        `assertValidTarget: reach minimum must be > 0, got ${formatFraction(target.minimum)}`,
      );
    }
    if (!lte(target.minimum, target.ideal)) {
      throw new RangeError(
        `assertValidTarget: reach minimum (${formatFraction(target.minimum)}) must be <= ideal (${formatFraction(target.ideal)})`,
      );
    }
    return;
  }
  // direction === "limit"
  if (!gte(target.ideal, ZERO)) {
    throw new RangeError(
      `assertValidTarget: limit ideal must be >= 0, got ${formatFraction(target.ideal)}`,
    );
  }
  if (!lte(target.ideal, target.tolerance)) {
    throw new RangeError(
      `assertValidTarget: limit ideal (${formatFraction(target.ideal)}) must be <= tolerance (${formatFraction(target.tolerance)})`,
    );
  }
}

function formatFraction(f: Fraction): string {
  return `${f.num}/${f.den}`;
}

const MIN_WEIGHT_PERCENT = 5;
const MAX_WEIGHT_PERCENT = 100;
const WEIGHT_STEP_PERCENT = 5;
const TOTAL_WEIGHT_PERCENT = 100;

/**
 * Validates the pact-level invariant: weights are each a 5%-step between 5
 * and 100, sum to exactly 100 across all commitments, and every
 * commitment's target is valid ({@link assertValidTarget}) — this is the
 * single boundary validation point; nothing downstream re-checks either
 * invariant.
 *
 * @throws {RangeError} on any violation — this is a programmer/use-case
 * error (the app validates user input before constructing commitments), not
 * a recoverable domain outcome.
 */
export function assertValidCommitments(commitments: readonly Commitment[]): void {
  let total = 0;
  for (const commitment of commitments) {
    const { weightPercent } = commitment;
    if (
      weightPercent < MIN_WEIGHT_PERCENT ||
      weightPercent > MAX_WEIGHT_PERCENT ||
      weightPercent % WEIGHT_STEP_PERCENT !== 0
    ) {
      throw new RangeError(
        `assertValidCommitments: weightPercent ${weightPercent} must be a multiple of ${WEIGHT_STEP_PERCENT} between ${MIN_WEIGHT_PERCENT} and ${MAX_WEIGHT_PERCENT}`,
      );
    }
    assertValidTarget(commitment.unit === "done" ? targetOf(commitment) : commitment.target);
    total += weightPercent;
  }
  if (total !== TOTAL_WEIGHT_PERCENT) {
    throw new RangeError(
      `assertValidCommitments: weights must sum to ${TOTAL_WEIGHT_PERCENT}, got ${total}`,
    );
  }
}
