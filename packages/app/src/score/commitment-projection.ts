import type { CommitmentId, CommitmentScoreEntry, MemberId, Streak } from "@pactjoy/engine";
import { displayPercent, displayPoints } from "@pactjoy/engine";
import type { CommitmentRecord, Measure } from "../commitment/commitment.ts";
import type { HabitId } from "../shared/ids.ts";

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
      readonly measure: Measure;
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
    measure: record.measure,
    points,
    consistency: score.consistency === null ? null : displayPercent(score.consistency),
    idealCompletion: score.idealCompletion === null ? null : displayPercent(score.idealCompletion),
    streak: score.streak,
  };
}
