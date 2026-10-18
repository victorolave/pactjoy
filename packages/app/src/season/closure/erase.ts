import type { MemberId } from "@pactjoy/engine";
import { graduationKey } from "../../feed/feed-key.ts";
import type { Repositories } from "../../ports/repositories.ts";
import type { SeasonId } from "../../shared/ids.ts";
import type { Season } from "../season.ts";

/**
 * Erases private decisions and ALL reactions targeting their disappearing graduation items.
 * Caller locks circles then seasons, in stable order, until commit. Keys come from commitments,
 * not from the closure being deleted, so retry also removes already-orphaned reactions.
 * No replacement graduation fact is retained (binding owner option A, ADR-0019).
 */
export async function eraseMemberClosures(
  repos: Pick<Repositories, "seasonClosures" | "feedReactions">,
  memberIds: readonly MemberId[],
  seasons: readonly Season[],
): Promise<void> {
  const members = new Set(memberIds);
  for (const season of seasons) {
    const keys = new Set(
      season.commitments
        .filter((commitment) => members.has(commitment.memberId))
        .map((commitment) => graduationKey(commitment.habitId)),
    );
    if (keys.size === 0) continue;
    for (const reaction of await repos.feedReactions.listBySeason(season.id)) {
      if (keys.has(reaction.itemKey)) {
        await repos.feedReactions.remove(reaction.id, reaction.version);
      }
    }
  }
  await repos.seasonClosures.deleteByMembers(memberIds);
}

/**
 * INSIDE the transaction (a fully erased circle): deletes every closure of the seasons with its
 * decisions. Their reactions go with `dropSeasonReactions`.
 */
export async function dropSeasonClosures(
  repos: Pick<Repositories, "seasonClosures">,
  seasonIds: readonly SeasonId[],
): Promise<void> {
  await repos.seasonClosures.deleteBySeasons(seasonIds);
}
