import type { MemberId } from "@pactjoy/engine";
import type { Repositories } from "../ports/repositories.ts";
import type { SeasonId } from "../shared/ids.ts";

/**
 * INSIDE the transaction (account erasure, ADR-0019): deletes the members' reminder settings in
 * every season. Lives here because `repos.reminders` is confined to this module
 * (`reminder-guard.test.ts`).
 */
export async function eraseMemberReminders(
  repos: Pick<Repositories, "reminders">,
  memberIds: readonly MemberId[],
): Promise<void> {
  await repos.reminders.deleteByMembers(memberIds);
}

/** INSIDE the transaction (a fully erased circle): deletes every reminder setting of the seasons. */
export async function dropSeasonReminders(
  repos: Pick<Repositories, "reminders">,
  seasonIds: readonly SeasonId[],
): Promise<void> {
  await repos.reminders.deleteBySeasons(seasonIds);
}
