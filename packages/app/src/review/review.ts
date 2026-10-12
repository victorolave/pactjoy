import type { CommitmentId, MemberId } from "@pactjoy/engine";
import type { ReviewId, SeasonId } from "../shared/ids.ts";
import type { Instant } from "../time/instant.ts";

/** Which review a record is: the optional first SRBAI, a periodic one, or the season's last. */
export type ReviewKind = "baseline" | "interim" | "closing";

/** `skipped` exists only for the baseline (a stored "Ahora no" that stops the offer). */
export type ReviewStatus = "completed" | "skipped";

/** How many SRBAI items were asked per Commitment: all four, or item 1 only. */
export type SrbaiMode = "full" | "item1";

/** One SRBAI answer on the 1..7 scale. */
export type SrbaiScore = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** The four SRBAI items of one Commitment. Item 1 is always answered; items 2-4 only in a full review. */
export type SrbaiItems = readonly [
  SrbaiScore,
  SrbaiScore | null,
  SrbaiScore | null,
  SrbaiScore | null,
];

/** What a member answered about ONE of their Commitments. */
export interface AutomaticityResponse {
  readonly commitmentId: CommitmentId;
  readonly items: SrbaiItems;
}

/** The two optional free-text fields: "que te ayudo" and "que costo mas". Absent is `null`. */
export interface ReviewReflection {
  readonly helped: string | null;
  readonly hard: string | null;
}

/**
 * The Review aggregate (Revision periodica): what ONE member answered for ONE period of a season,
 * identified by `(seasonId, memberId, periodIndex)` (period 0 is the baseline). It stores answers
 * only; the period summary figures are never stored (they are recomputed from Entries). A saved
 * review is final: it is inserted once and cannot be edited, so `version` never moves past 0 in
 * this change. Whether a review is pending or lapsed is DERIVED on read (`review-schedule.ts`),
 * nothing is stored for it.
 *
 * Invariant: `status === "completed"` exactly when `srbai !== null` (a skipped baseline carries no
 * answers, no reflection and no responses).
 */
export interface ReviewRecord {
  readonly id: ReviewId;
  readonly seasonId: SeasonId;
  readonly memberId: MemberId;
  /** 0 for the baseline, 1..P for the periods of the season. */
  readonly periodIndex: number;
  readonly kind: ReviewKind;
  readonly status: ReviewStatus;
  readonly srbai: SrbaiMode | null;
  readonly reflection: ReviewReflection;
  readonly responses: readonly AutomaticityResponse[];
  readonly recordedAt: Instant;
  readonly version: number;
}
