import type {
  CommitmentId,
  MemberId,
  PerSessionSchedule,
  QuantityUnit,
  Schedule,
  Target,
} from "@pactjoy/engine";
import type { HabitId } from "../shared/ids.ts";

/** Max length for a custom quantity-unit label (A12, SS-11). */
export const MAX_CUSTOM_LABEL_LENGTH = 20;

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
      readonly target: Target;
      readonly schedule: Schedule;
    };

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
