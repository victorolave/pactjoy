import type { MemberId } from "@pactjoy/engine";
import type { Repositories } from "../ports/repositories.ts";
import type { Season } from "../season/season.ts";
import type { SeasonId } from "../shared/ids.ts";
import type { LocalDate } from "../time/local-date.ts";
import type { ReviewKind } from "./review.ts";
import { dueSlot, dueUntilOf, reviewDayOf, reviewSlots } from "./review-schedule.ts";

/** The periodic review waiting for the member (REQ-T1): interim, or the closing one once due. */
export interface PendingReview {
  readonly seasonId: SeasonId;
  readonly periodIndex: number;
  readonly kind: Exclude<ReviewKind, "baseline">;
  /** All four SRBAI items per commitment, versus item 1 only. */
  readonly fullSrbai: boolean;
  /** The weeks the review covers (1-based, inclusive). */
  readonly firstWeek: number;
  readonly lastWeek: number;
  /** The last day it can be answered; `null` for the closing review, which never lapses. */
  readonly dueUntil: LocalDate | null;
  /** The period summary can be read (always true: a review is due only once its period ended). */
  readonly summaryAvailable: boolean;
}

/** The optional first SRBAI offered after the pact closes (screen 13). */
export interface BaselineOffer {
  readonly seasonId: SeasonId;
  readonly periodIndex: 0;
  readonly offeredUntil: LocalDate;
}

/** What Today carries about reviews. Never both set: the baseline and the first review do not overlap. */
export interface ReviewOffer {
  readonly pendingReview: PendingReview | null;
  readonly baselineOffer: BaselineOffer | null;
}

const NONE: ReviewOffer = { pendingReview: null, baselineOffer: null };

export interface PendingReviewArgs {
  readonly season: Season;
  readonly memberId: MemberId;
  /** The season-timezone civil date the read observed. */
  readonly today: LocalDate;
}

/**
 * The review the member is being asked for on `today`, or none. Derived on read from the season
 * calendar and what the member has stored; it writes nothing (REQ-R7). A season whose pact is
 * still open, and a member with no commitment, have no review (REQ-R9). This is the owner's own
 * read: it never takes another member's id from a request.
 */
export async function pendingReviewOf(
  repos: Pick<Repositories, "reviews">,
  args: PendingReviewArgs,
): Promise<ReviewOffer> {
  const { season, memberId, today } = args;
  const start = season.actualStart;
  if (season.status !== "active" || start === null) return NONE;
  if (!season.commitments.some((commitment) => commitment.memberId === memberId)) return NONE;
  const stored = await repos.reviews.listMine(season.id, memberId);
  const due = dueSlot(
    reviewSlots({
      lengthWeeks: season.lengthWeeks,
      cadence: season.reviewCadenceWeeks,
      pactClosed: true,
      today: reviewDayOf(today, start),
      stored,
    }),
  );
  if (due === null) return NONE;
  if (due.kind === "baseline") {
    const until = dueUntilOf(due, start);
    if (until === null) return NONE;
    return {
      pendingReview: null,
      baselineOffer: { seasonId: season.id, periodIndex: 0, offeredUntil: until },
    };
  }
  if (due.firstWeek === null || due.lastWeek === null) return NONE;
  return {
    pendingReview: {
      seasonId: season.id,
      periodIndex: due.index,
      kind: due.kind,
      fullSrbai: due.srbai === "full",
      firstWeek: due.firstWeek,
      lastWeek: due.lastWeek,
      dueUntil: dueUntilOf(due, start),
      summaryAvailable: true,
    },
    baselineOffer: null,
  };
}
