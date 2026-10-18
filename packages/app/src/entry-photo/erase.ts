import type { MemberId } from "@pactjoy/engine";
import type { EvidenceStorage } from "../ports/evidence-storage.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { SeasonId } from "../shared/ids.ts";
import type { EntryPhoto } from "./entry-photo.ts";
import { type PurgeDeps, purgeReleased } from "./photo-lifecycle.ts";

/** Rows purged per batch after an erasure, and how many batches at most; the sweep takes the rest. */
export const PURGE_BATCH = 50;
export const PURGE_MAX_BATCHES = 4;

/**
 * INSIDE the transaction (account erasure, ADR-0019): releases every pending and attached photo of
 * the members and returns ALL their released rows, those released earlier by a replace, a remove or
 * an entry delete included, so the caller can purge their objects after the commit.
 * The entries' own links are cleared by `entries.eraseEvidence`. Overrides "kept on leave" (ADR-0016)
 * for deletion only.
 */
export function releaseMemberPhotos(
  repos: Pick<Repositories, "entryPhotos">,
  memberIds: readonly MemberId[],
): Promise<readonly EntryPhoto[]> {
  return repos.entryPhotos.releaseAllOfMembers(memberIds);
}

/**
 * INSIDE the transaction (a fully erased circle): deletes the ledger rows of the seasons whatever
 * their status and returns them. Their entries must already be deleted (RESTRICT). The objects go
 * after the commit, through {@link deleteObjects}.
 */
export function dropSeasonPhotos(
  repos: Pick<Repositories, "entryPhotos">,
  seasonIds: readonly SeasonId[],
): Promise<readonly EntryPhoto[]> {
  return repos.entryPhotos.deleteBySeasons(seasonIds);
}

/**
 * AFTER the commit: deletes the objects of the `released` rows, then the rows, in bounded batches
 * (`PURGE_MAX_BATCHES` of `PURGE_BATCH`). Best effort: a failure is swallowed (the row stays
 * released for the sweep, ADR-0016) and counted in `left`, which also counts rows beyond the bound.
 * Never throws.
 */
export async function purgeErasedPhotos(
  deps: PurgeDeps,
  released: readonly EntryPhoto[],
): Promise<{ readonly purged: number; readonly left: number }> {
  let purged = 0;
  try {
    for (let batch = 0; batch < PURGE_MAX_BATCHES; batch++) {
      const slice = released.slice(batch * PURGE_BATCH, (batch + 1) * PURGE_BATCH);
      if (slice.length === 0) break;
      const done = await purgeReleased(deps, slice);
      purged += done;
      // Nothing went through: the storage or the ledger is down, so stop hammering it.
      if (done === 0) break;
    }
  } catch {
    // Left released for the sweep.
  }
  return { purged, left: released.length - purged };
}

/**
 * AFTER the commit: deletes the objects of rows already dropped from the ledger. A failure leaves an
 * opaque orphan object with no row to reach it (ADR-0019 E6); it is swallowed and counted. Never throws.
 */
export async function deleteObjects(
  deps: { readonly evidence: EvidenceStorage },
  dropped: readonly EntryPhoto[],
): Promise<{ readonly deleted: number; readonly failed: number }> {
  let deleted = 0;
  for (const photo of dropped) {
    try {
      await deps.evidence.delete(photo.objectKey);
      deleted += 1;
    } catch {
      // Counted below.
    }
  }
  return { deleted, failed: dropped.length - deleted };
}
