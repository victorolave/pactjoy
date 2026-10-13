import type { MemberId } from "@pactjoy/engine";
import type { Repositories } from "../ports/repositories.ts";
import type { SeasonId } from "../shared/ids.ts";

/**
 * Whether `memberId` has completed at least one PERIODIC review (interim or closing) in the
 * season. The baseline never counts, and neither does a skipped one. Owner-only like every read in
 * this module: the caller passes the asking member's own id (the port has no season-wide read).
 */
export async function hasCompletedPeriodicReview(
  repos: Repositories,
  seasonId: SeasonId,
  memberId: MemberId,
): Promise<boolean> {
  const reviews = await repos.reviews.listMine(seasonId, memberId);
  return reviews.some((review) => review.status === "completed" && review.kind !== "baseline");
}
