import type { MemberId } from "@pactjoy/engine";
import type { Repositories } from "../ports/repositories.ts";
import type { SeasonId } from "../shared/ids.ts";

/**
 * INSIDE the transaction (account erasure, ADR-0019): deletes every private review of the members,
 * with their reflections and automaticity answers. The caller holds the circle and season guards.
 * Lives here because `repos.reviews` is confined to this module (`review-guard.test.ts`).
 */
export async function eraseMemberReviews(
  repos: Pick<Repositories, "reviews">,
  memberIds: readonly MemberId[],
): Promise<void> {
  await repos.reviews.deleteByMembers(memberIds);
}

/** INSIDE the transaction (a fully erased circle): deletes every review of the seasons. */
export async function dropSeasonReviews(
  repos: Pick<Repositories, "reviews">,
  seasonIds: readonly SeasonId[],
): Promise<void> {
  await repos.reviews.deleteBySeasons(seasonIds);
}
