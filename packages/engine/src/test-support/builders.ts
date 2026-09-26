/**
 * Fixture builders for tests only — never exported from `index.ts`.
 *
 * Only `Commitment` builders exist so far, because they're the only ones
 * exercised by a slice-2 test. `Entry`/`Season` builders are deferred to the
 * slice that first needs them (opportunity generation, slice 3) rather than
 * added speculatively here.
 */
import type {
  DoneCommitment,
  Frequency,
  QuantityCommitment,
  QuantityUnit,
  Target,
} from "../commitment/commitment";

const DEFAULT_FREQUENCY: Frequency = { kind: "timesPerWeek", times: 3 };

export function buildDoneCommitment(
  id: string,
  weightPercent: number,
  frequency: Frequency = DEFAULT_FREQUENCY,
): DoneCommitment {
  return {
    id: id as DoneCommitment["id"],
    weightPercent,
    unit: "done",
    schedule: { period: "perSession", frequency },
  };
}

export function buildQuantityCommitment(
  id: string,
  weightPercent: number,
  unit: QuantityUnit,
  target: Target,
  frequency: Frequency = DEFAULT_FREQUENCY,
): QuantityCommitment {
  return {
    id: id as QuantityCommitment["id"],
    weightPercent,
    unit,
    target,
    schedule: { period: "perSession", frequency },
  };
}
