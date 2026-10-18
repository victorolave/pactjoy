import type { MemberId } from "@pactjoy/engine";
import type { Repositories } from "../ports/repositories.ts";
import type { SeasonId } from "../shared/ids.ts";

/**
 * INSIDE the transaction (account erasure, ADR-0019): deletes the encouragements the members
 * RECEIVED and every nudge dismissal they made or that targets them. What they SENT stays: it is
 * anonymous (an id, an emoji and a week, readable only by its recipient). Only deletes, so the
 * ports keep their "no season-wide read" shape (`encouragement-guard.test.ts`). Lives here because
 * `repos.encouragements` and `repos.nudgeDismissals` are confined to this module.
 */
export async function eraseMemberEncouragements(
  repos: Pick<Repositories, "encouragements" | "nudgeDismissals">,
  memberIds: readonly MemberId[],
): Promise<void> {
  await repos.encouragements.deleteByRecipients(memberIds);
  await repos.nudgeDismissals.deleteByMembers(memberIds);
}

/** INSIDE the transaction (a fully erased circle): deletes every encouragement and dismissal of the seasons. */
export async function dropSeasonEncouragements(
  repos: Pick<Repositories, "encouragements" | "nudgeDismissals">,
  seasonIds: readonly SeasonId[],
): Promise<void> {
  await repos.encouragements.deleteBySeasons(seasonIds);
  await repos.nudgeDismissals.deleteBySeasons(seasonIds);
}
