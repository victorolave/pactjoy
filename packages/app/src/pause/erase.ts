import type { MemberId } from "@pactjoy/engine";
import type { Repositories } from "../ports/repositories.ts";
import type { SeasonId } from "../shared/ids.ts";
import { loadEffectiveRequests, type PauseContext } from "./effective-pauses.ts";

/**
 * INSIDE the transaction (account erasure, ADR-0019 E9): blanks what a member wrote on their Pause
 * requests, `note := null` and `reason := 'other'` (a health category is sensitive), through a
 * normal version-checked `save` so a concurrent peer response conflicts instead of re-writing the
 * stale note. Scoring fields (start, end, status, decision, commitments) and the responses are
 * untouched, so every effective Pause and every standing stays the same. A request already blank is
 * skipped, so a repeat writes nothing. The requests are read through the choke point
 * (`loadEffectiveRequests`), which is empty for a season that has not started.
 * @returns how many requests were rewritten.
 */
export async function eraseMemberPauseDetails(
  repos: Pick<Repositories, "pauses">,
  context: PauseContext,
  memberIds: readonly MemberId[],
): Promise<number> {
  let erased = 0;
  for (const { record } of await loadEffectiveRequests(repos, context)) {
    if (!memberIds.includes(record.memberId)) continue;
    if (record.note === null && record.reason === "other") continue;
    await repos.pauses.save(
      { ...record, note: null, reason: "other", version: record.version + 1 },
      record.version,
    );
    erased += 1;
  }
  return erased;
}

/** INSIDE the transaction (a fully erased circle): deletes every request of the seasons. */
export async function dropSeasonPauses(
  repos: Pick<Repositories, "pauses">,
  seasonIds: readonly SeasonId[],
): Promise<void> {
  await repos.pauses.deleteBySeasons(seasonIds);
}
