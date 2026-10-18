import type { Repositories } from "../ports/repositories.ts";
import type { SeasonId } from "../shared/ids.ts";

/**
 * INSIDE the transaction (a fully erased circle, ADR-0019): deletes every feed reaction of the
 * seasons. An erased member's own reactions to peers' items are NOT deleted when the circle lives
 * on (they stay pseudonymous), and graduation reactions go with their season closure
 * (`eraseMemberClosures`), so there is no per-member helper here.
 */
export async function dropSeasonReactions(
  repos: Pick<Repositories, "feedReactions">,
  seasonIds: readonly SeasonId[],
): Promise<void> {
  await repos.feedReactions.deleteBySeasons(seasonIds);
}
