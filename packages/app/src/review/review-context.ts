import type { Circle } from "../circle/circle.ts";
import { findActiveMember, type Member } from "../circle/circle.ts";
import type { CommitmentRecord } from "../commitment/commitment.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { Season } from "../season/season.ts";
import type { Actor } from "../shared/actor.ts";
import type { SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import type { Instant } from "../time/instant.ts";
import type { LocalDate } from "../time/local-date.ts";
import type { TimeZone } from "../time/time-zone.port.ts";
import type { ReviewRecord } from "./review.ts";
import { type ReviewSlot, reviewDayOf, reviewSlots } from "./review-schedule.ts";

/** What the review use cases read besides the stores: the instant and the season's zone. */
export interface ReviewClockDeps {
  readonly clock: Clock;
  readonly timeZone: TimeZone;
}

export type ReviewContextError =
  | { readonly kind: "SeasonNotFound" }
  | { readonly kind: "NotAMember" }
  | { readonly kind: "SeasonNotActive" }
  | { readonly kind: "ReviewPeriodNotFound" };

/**
 * Everything a review use case needs about ONE period of the asking member's own season, resolved
 * once: the member, their commitments, what they stored, the derived slots and the requested one.
 */
export interface ReviewContext {
  readonly season: Season;
  readonly circle: Circle;
  readonly member: Member;
  /** The member's own commitments, in season order (private ones included: it is their review). */
  readonly mine: readonly CommitmentRecord[];
  readonly actualStart: LocalDate;
  /** The ONE instant this call observed. */
  readonly now: Instant;
  readonly today: LocalDate;
  readonly stored: readonly ReviewRecord[];
  readonly slots: readonly ReviewSlot[];
  /** The requested period's slot, with its derived status. */
  readonly slot: ReviewSlot;
}

/**
 * Resolves the asking member and the requested period. The actor is always the owner: no member id
 * ever comes from a request, so a peer's review cannot be addressed. Rejects, in this order:
 * unknown season, non-member (only ACTIVE members), a season that is not running (pact open or
 * closed), and a period the member does not have (out of range, or the member has no commitment,
 * REQ-R9).
 */
export async function loadReviewContext(
  deps: ReviewClockDeps,
  repos: Repositories,
  actor: Actor,
  seasonId: SeasonId,
  periodIndex: number,
): Promise<Result<ReviewContext, ReviewContextError>> {
  const season = await repos.seasons.get(seasonId);
  if (!season) return err({ kind: "SeasonNotFound" });
  const circle = await repos.circles.get(season.circleId);
  const member = circle ? findActiveMember(circle, actor.userId) : undefined;
  if (!circle || !member) return err({ kind: "NotAMember" });
  const actualStart = season.actualStart;
  if (season.status !== "active" || actualStart === null) return err({ kind: "SeasonNotActive" });

  const mine = season.commitments.filter((commitment) => commitment.memberId === member.id);
  const now = deps.clock.now();
  const today = deps.timeZone.localDateAt(now, season.timeZone);
  const stored = await repos.reviews.listMine(season.id, member.id);
  const slots = reviewSlots({
    lengthWeeks: season.lengthWeeks,
    cadence: season.reviewCadenceWeeks,
    pactClosed: true,
    today: reviewDayOf(today, actualStart),
    stored,
  });
  const slot = Number.isInteger(periodIndex)
    ? slots.find((candidate) => candidate.index === periodIndex)
    : undefined;
  if (slot === undefined || mine.length === 0) return err({ kind: "ReviewPeriodNotFound" });
  return ok({ season, circle, member, mine, actualStart, now, today, stored, slots, slot });
}

/** Why a slot cannot be answered or skipped now, or `null` when it is due. */
export type SlotRefusal =
  | { readonly kind: "ReviewAlreadySubmitted" }
  | { readonly kind: "ReviewNotDue"; readonly reason: "notYet" | "lapsed" };

export function refusalOf(slot: ReviewSlot): SlotRefusal | null {
  switch (slot.status) {
    case "due":
      return null;
    case "completed":
    case "skipped":
      return { kind: "ReviewAlreadySubmitted" };
    case "upcoming":
      return { kind: "ReviewNotDue", reason: "notYet" };
    case "lapsed":
      return { kind: "ReviewNotDue", reason: "lapsed" };
  }
}
