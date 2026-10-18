import { type MemberId, seasonDay } from "@pactjoy/engine";
import type { Repositories } from "../ports/repositories.ts";
import type { Season } from "../season/season.ts";
import type { LocalDate } from "../time/local-date.ts";
import { localDateOfSeasonDay } from "../time/season-calendar.ts";
import { pendingReviewOf } from "./pending-review.ts";
import { reviewPeriods } from "./review-schedule.ts";

/**
 * What the notification planner and dispatcher need to know about reviews (ADR-0017), answered
 * inside the owner-only review module (`review-guard.test.ts`): the calendar, and whether one
 * member's own review is still due. Nothing here reads another member's review for a peer.
 */

/**
 * The interim review whose window opens on `date` (its `dueFromDay`), or `null`. The closing
 * review never gets a `reviewDue`: the `seasonClosed` notice absorbs it (REQ-K5).
 */
export function interimReviewDueFrom(season: Season, date: LocalDate): number | null {
  const start = season.actualStart;
  if (start === null) return null;
  const period = reviewPeriods(season.lengthWeeks, season.reviewCadenceWeeks).find(
    (p) =>
      p.kind === "interim" &&
      p.dueFromDay !== null &&
      localDateOfSeasonDay(seasonDay(p.dueFromDay - 1), start) === date,
  );
  return period?.index ?? null;
}

/** Whether `memberId`'s review for `periodIndex` is the one due on `today` (not done, not lapsed). */
export async function isReviewDue(
  repos: Pick<Repositories, "reviews">,
  season: Season,
  memberId: MemberId,
  periodIndex: number,
  today: LocalDate,
): Promise<boolean> {
  const offer = await pendingReviewOf(repos, { season, memberId, today });
  return offer.pendingReview?.periodIndex === periodIndex;
}
