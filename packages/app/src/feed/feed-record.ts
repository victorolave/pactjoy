import type { CommitmentId, Fraction, MemberId } from "@pactjoy/engine";
import type { PauseReason } from "../pause/pause-request.ts";
import type { HabitId } from "../shared/ids.ts";
import type { Instant } from "../time/instant.ts";
import type { LocalDate } from "../time/local-date.ts";

/**
 * One derived fact of the circle's season, BEFORE it is shown to anyone (ADR-0018, F1). It is the
 * same for every viewer, so it names commitments and habits by id only: turning ids into names
 * and masking the private ones is `feed-view.ts`'s job, per viewer.
 *
 * Privacy is structural. A record has no note, no photo and no id of either, and the only value
 * it carries is a completed session's `amount`, which the view drops for a private commitment.
 */
export interface FeedRecordBase {
  /** The stable key of the item (`feed-key.ts`). */
  readonly key: string;
  /** The civil day the item belongs to, in the season's time zone (the main sort field). */
  readonly onDate: LocalDate;
  /** When it happened, or `null` for items that belong to a day rather than an instant. */
  readonly at: Instant | null;
}

export type FeedRecord = FeedRecordBase &
  (
    | {
        readonly kind: "completed";
        readonly memberId: MemberId;
        readonly commitmentId: CommitmentId;
        /** The summed quantity of the opportunity; `null` for a `done` commitment. */
        readonly amount: Fraction | null;
      }
    | {
        readonly kind: "consistentWeek";
        readonly memberId: MemberId;
        readonly commitmentId: CommitmentId;
        /** 1-based season week. */
        readonly week: number;
        readonly kept: number;
        readonly counted: number;
      }
    | { readonly kind: "comeback"; readonly memberId: MemberId }
    | {
        readonly kind: "paused";
        readonly memberId: MemberId;
        /** The commitments the pause really covers (at least one day), in the request's order. */
        readonly commitmentIds: readonly CommitmentId[];
        readonly reason: PauseReason;
      }
    | {
        readonly kind: "pointsRecalculated";
        readonly memberId: MemberId;
        readonly commitmentIds: readonly CommitmentId[];
      }
    | {
        readonly kind: "graduated";
        readonly memberId: MemberId;
        readonly habitId: HabitId;
        /** The commitments of the feed season that work the habit. */
        readonly commitmentIds: readonly CommitmentId[];
      }
    | { readonly kind: "seasonStarted"; readonly lengthWeeks: number }
    | { readonly kind: "seasonClosed" }
  );

export type FeedRecordKind = FeedRecord["kind"];

/** The kinds a peer may react to: a member's own activity, never a system item. */
export const REACTABLE_KINDS: readonly FeedRecordKind[] = [
  "completed",
  "consistentWeek",
  "comeback",
  "paused",
  "graduated",
];

/** The member an item is about, or `null` for a system item (season start and close). */
export function subjectMemberOf(record: FeedRecord): MemberId | null {
  return "memberId" in record ? record.memberId : null;
}
