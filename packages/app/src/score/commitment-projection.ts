import type {
  CommitmentId,
  CommitmentScoreEntry,
  MemberId,
  PerSessionSchedule,
  QuantityUnit,
  Schedule,
  Streak,
} from "@pactjoy/engine";
import { displayPercent, displayPoints } from "@pactjoy/engine";
import type { CommitmentRecord, Measure, QuantityPrecision } from "../commitment/commitment.ts";
import { toDecimalString } from "../shared/decimal.ts";
import type { HabitId } from "../shared/ids.ts";

/**
 * A {@link Measure} as a client receives it: thresholds are exact decimal
 * strings, because engine fractions hold BigInt and do not serialize.
 */
export type MeasureView =
  | { readonly unit: "done"; readonly schedule: PerSessionSchedule }
  | {
      readonly unit: QuantityUnit;
      readonly customLabel: string | null;
      readonly precision: QuantityPrecision;
      readonly target:
        | { readonly direction: "reach"; readonly minimum: string; readonly ideal: string }
        | { readonly direction: "limit"; readonly ideal: string; readonly tolerance: string };
      readonly schedule: Schedule;
    };

function projectMeasure(measure: Measure): MeasureView {
  if (measure.unit === "done") {
    return measure;
  }
  const { target } = measure;
  return {
    unit: measure.unit,
    customLabel: measure.customLabel,
    precision: measure.precision,
    target:
      target.direction === "reach"
        ? {
            direction: "reach",
            minimum: toDecimalString(target.minimum),
            ideal: toDecimalString(target.ideal),
          }
        : {
            direction: "limit",
            ideal: toDecimalString(target.ideal),
            tolerance: toDecimalString(target.tolerance),
          },
    schedule: measure.schedule,
  };
}

/**
 * One commitment as a particular viewer is allowed to see it (Notion
 * "Privada"/"Visible", SQ-1..SQ-3). Numbers are already rounded by the
 * engine's display boundary (D10).
 *
 * - `detail`: the full commitment. Shown to its owner always, and to every
 *   circle member when the commitment is `visible`.
 * - `hidden`: a `private` commitment seen by anyone else. Reveals only that
 *   it exists, its weight and its points; NOT its habit, unit, direction,
 *   period, frequency, thresholds, consistency, ideal completion or streak.
 */
export type CommitmentScoreView =
  | {
      readonly kind: "detail";
      readonly commitmentId: CommitmentId;
      readonly habitId: HabitId;
      readonly weightPercent: number;
      readonly privacy: "visible" | "private";
      readonly measure: MeasureView;
      readonly points: number;
      readonly consistency: number | null;
      readonly idealCompletion: number | null;
      readonly streak: Streak;
    }
  | {
      readonly kind: "hidden";
      readonly commitmentId: CommitmentId;
      readonly weightPercent: number;
      readonly points: number;
    };

/** Projects one scored commitment for `viewer`; the single place privacy is decided. */
export function projectCommitment(
  record: CommitmentRecord,
  score: CommitmentScoreEntry,
  viewer: MemberId,
): CommitmentScoreView {
  const points = displayPoints(score.points);
  if (record.privacy === "private" && record.memberId !== viewer) {
    return {
      kind: "hidden",
      commitmentId: record.id,
      weightPercent: record.weightPercent,
      points,
    };
  }
  return {
    kind: "detail",
    commitmentId: record.id,
    habitId: record.habitId,
    weightPercent: record.weightPercent,
    privacy: record.privacy,
    measure: projectMeasure(record.measure),
    points,
    consistency: score.consistency === null ? null : displayPercent(score.consistency),
    idealCompletion: score.idealCompletion === null ? null : displayPercent(score.idealCompletion),
    streak: score.streak,
  };
}
