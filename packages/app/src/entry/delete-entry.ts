import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Actor } from "../shared/actor.ts";
import type { EntryId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import type { TimeZone } from "../time/time-zone.port.ts";
import { loadMutableEntry, type OwnEntryError } from "./own-entry.ts";

export interface DeleteEntryDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly clock: Clock;
  readonly timeZone: TimeZone;
}

export interface DeleteEntryInput {
  readonly entryId: EntryId;
}

export type DeleteEntryError = Exclude<OwnEntryError, { readonly kind: "EntryDeleted" }>;

/**
 * Deletes `actor`'s own Entry while its window is open (ER-10..ER-13, A9,
 * B8): the same ownership, season and window checks as `editEntry`. It
 * leaves a tombstone that blanks value and note but keeps the idempotency
 * key. Deleting it again succeeds and changes nothing. Points are
 * recomputed from the remaining entries. Fails with `ConcurrencyConflict`
 * if the entry was edited or deleted meanwhile (version check) or the
 * membership or season read here changed before commit (D5).
 */
export async function deleteEntry(
  deps: DeleteEntryDeps,
  actor: Actor,
  input: DeleteEntryInput,
): Promise<Result<void, DeleteEntryError>> {
  return deps.uow.transaction(async (repos): Promise<Result<void, DeleteEntryError>> => {
    const loaded = await loadMutableEntry(deps, repos, actor, input.entryId);
    if (!loaded.ok) {
      // Idempotent: deleting your own, already deleted, entry is a success.
      if (loaded.error.kind === "EntryDeleted") {
        return ok(undefined);
      }
      return err(loaded.error);
    }
    const { entry, season, circle } = loaded.value;

    await repos.circles.guardVersion(circle.id, circle.version);
    await repos.seasons.guardVersion(season.id, season.version);
    await repos.entries.remove(entry.id, entry.version);
    return ok(undefined);
  });
}
