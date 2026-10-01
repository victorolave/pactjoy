import {
  type CommitmentId,
  eq,
  type Frequency,
  type MemberId,
  type PerSessionSchedule,
  type QuantityUnit,
  type Schedule,
  type Target,
} from "@pactjoy/engine";
import type { HabitId } from "../shared/ids.ts";

/**
 * Quantities (commitment thresholds and entry values) are capped at this
 * many significant integer digits, keeping exact fractions small.
 */
export const MAX_INTEGER_DIGITS = 9;

/** Max length for a custom quantity-unit label (A12, SS-11). */
export const MAX_CUSTOM_LABEL_LENGTH = 20;

/**
 * Whether a quantity unit is counted in whole things (`integer`) or allows
 * up to 2 decimals (`decimal`). It applies to the commitment's targets
 * (minimum, ideal, tolerance) and to every entry logged against it.
 */
export type QuantityPrecision = "integer" | "decimal";

const INTEGER_UNITS: readonly QuantityUnit[] = ["times", "pages", "glasses"];

/**
 * The precision a built-in unit always has: times, pages and glasses are
 * whole things; minutes, hours and km take up to 2 decimals. `custom`
 * units have no fixed answer -- the commitment chooses (default `decimal`,
 * see `validate-commitment.ts`).
 */
export function precisionOfUnit(unit: QuantityUnit): QuantityPrecision | null {
  if (unit === "custom") return null;
  return INTEGER_UNITS.includes(unit) ? "integer" : "decimal";
}

/**
 * How a commitment measures progress (Unidad x Direccion x Periodo, P2
 * axes). `done` is only ever `reach` + `perSession` (engine R3) -- enforced
 * here at the type level, same trick the engine itself uses for
 * `DoneCommitment` (`packages/engine/src/commitment/commitment.ts`): the
 * `unit: "done"` variant carries only a `schedule` typed specifically as
 * `PerSessionSchedule`, so `{ unit: "done", schedule: { period:
 * "weeklyTotal" } }` cannot type-check as a {@link Measure}.
 */
export type Measure =
  | { readonly unit: "done"; readonly schedule: PerSessionSchedule }
  | {
      readonly unit: QuantityUnit;
      readonly customLabel: string | null;
      readonly precision: QuantityPrecision;
      readonly target: Target;
      readonly schedule: Schedule;
    };

function frequenciesEqual(a: Frequency, b: Frequency): boolean {
  if (a.kind === "timesPerWeek") return b.kind === "timesPerWeek" && a.times === b.times;
  if (b.kind !== "specificDays") return false;
  // A SET compare: validation checks distinct 0..6 but does not sort.
  const days = new Set<number>(a.weekdays);
  return days.size === b.weekdays.length && b.weekdays.every((day) => days.has(day));
}

function schedulesEqual(a: Schedule, b: Schedule): boolean {
  if (a.period === "weeklyTotal") return b.period === "weeklyTotal";
  return b.period === "perSession" && frequenciesEqual(a.frequency, b.frequency);
}

function targetsEqual(a: Target, b: Target): boolean {
  if (a.direction === "reach") {
    return b.direction === "reach" && eq(a.minimum, b.minimum) && eq(a.ideal, b.ideal);
  }
  return b.direction === "limit" && eq(a.ideal, b.ideal) && eq(a.tolerance, b.tolerance);
}

/**
 * Whether two measures are the same measurement (SS-13). Pure: thresholds
 * use the engine's exact-fraction `eq` (never object identity or floats)
 * and `specificDays` weekdays compare as a set, so a reordering of the same
 * days is equal. `editCommitment` uses it to detect a no-op edit.
 */
export function measuresEqual(a: Measure, b: Measure): boolean {
  if (a.unit === "done") return b.unit === "done" && schedulesEqual(a.schedule, b.schedule);
  if (b.unit === "done") return false;
  return (
    a.unit === b.unit &&
    a.customLabel === b.customLabel &&
    a.precision === b.precision &&
    targetsEqual(a.target, b.target) &&
    schedulesEqual(a.schedule, b.schedule)
  );
}

/**
 * How a member works a habit during one season (Compromiso, design D6/D12).
 * Lives inside `Season.commitments`, not its own aggregate or repository --
 * mutated only through the season's own optimistic `version` (ADR-0008,
 * D5), same pattern as every other field on `Season`.
 */
export interface CommitmentRecord {
  readonly id: CommitmentId;
  readonly memberId: MemberId;
  readonly habitId: HabitId;
  readonly weightPercent: number;
  readonly privacy: "visible" | "private";
  readonly measure: Measure;
}

/**
 * `CommitmentId`'s brand has no exported constructor in `@pactjoy/engine`
 * (same situation as `MemberId`, see `circle/circle.ts`'s `memberId()`) --
 * a single-step cast is the whole implementation. Centralized here so
 * every place that mints a `CommitmentId` (production `IdGenerator.next()`
 * results, test fixtures) goes through one function.
 */
export function commitmentId(value: string): CommitmentId {
  return value as CommitmentId;
}

export interface BuildCommitmentInput {
  readonly id: CommitmentId;
  readonly memberId: MemberId;
  readonly habitId: HabitId;
  readonly weightPercent: number;
  readonly privacy: "visible" | "private";
  readonly measure: Measure;
}

/**
 * Pure constructor for a brand-new {@link CommitmentRecord}. Assumes
 * `measure` was already validated (`validate-commitment.ts`'s
 * `validateCommitment` is the only production caller that builds one) --
 * this function only assembles already-valid inputs, same split as
 * `season.ts`'s `buildSeason` vs. `validateStartDateWindow`.
 */
export function buildCommitment(input: BuildCommitmentInput): CommitmentRecord {
  return {
    id: input.id,
    memberId: input.memberId,
    habitId: input.habitId,
    weightPercent: input.weightPercent,
    privacy: input.privacy,
    measure: input.measure,
  };
}

/**
 * A member's commitment weights must sum to exactly this to approve the
 * pact (B5, new PA-10) -- mirrors the engine's own internal
 * `TOTAL_WEIGHT_PERCENT` (not exported: pact-approval is the only app-side
 * caller, and unlike the reach/limit numeric invariants duplicated-then-
 * unified in S5 (#4758/#4835 fresh review), a bare `=== 100` sum check
 * carries no business logic worth centralizing behind an engine export).
 */
export const FULL_WEIGHT_PERCENT = 100;

/**
 * B5 (new PA-10): whether one member's own commitments' `weightPercent`
 * values sum to exactly {@link FULL_WEIGHT_PERCENT}. A member with zero
 * commitments sums to 0, which is never 100 -- so this single predicate
 * also covers "a member with zero commitments cannot approve" with no
 * separate special case. `approve-pact.ts` is the only production caller.
 */
export function commitmentsSumToFullWeight(commitments: readonly CommitmentRecord[]): boolean {
  const total = commitments.reduce((sum, commitment) => sum + commitment.weightPercent, 0);
  return total === FULL_WEIGHT_PERCENT;
}
