/**
 * Compile-time-only check (not a vitest file — `tsc --noEmit` type-checks
 * this, vitest never runs it).
 *
 * R3: `done` is only ever valid with `reach` + `perSession`. `DoneCommitment`
 * enforces this structurally (its `schedule` field is `PerSessionSchedule`
 * specifically), so this literal must NOT type-check as `Commitment`.
 */
import type { Commitment, CommitmentId } from "../commitment/commitment.ts";

// @ts-expect-error — R3: a done commitment cannot have a weeklyTotal schedule.
const invalidDoneCommitment: Commitment = {
  id: "x" as CommitmentId,
  weightPercent: 25,
  unit: "done",
  schedule: { period: "weeklyTotal" },
};

void invalidDoneCommitment;
