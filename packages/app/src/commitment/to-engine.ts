import type { Commitment } from "@pactjoy/engine";
import type { CommitmentRecord } from "./commitment.ts";

/**
 * Maps one {@link CommitmentRecord} to the engine's `Commitment` input
 * shape (design's Engine mapping, data-flow section). Drops `memberId`,
 * `habitId`, `privacy` and `measure.customLabel` -- app-only fields the
 * engine has no use for; `id` and `weightPercent` carry over unchanged,
 * and `unit`/`schedule`/`target` are already the exact same engine types
 * (D10: thresholds are already `Fraction`s, parsed once by
 * `validate-commitment.ts`, never re-parsed here).
 */
export function commitmentToEngine(record: CommitmentRecord): Commitment {
  if (record.measure.unit === "done") {
    return {
      id: record.id,
      weightPercent: record.weightPercent,
      unit: "done",
      schedule: record.measure.schedule,
    };
  }

  return {
    id: record.id,
    weightPercent: record.weightPercent,
    unit: record.measure.unit,
    target: record.measure.target,
    schedule: record.measure.schedule,
  };
}
