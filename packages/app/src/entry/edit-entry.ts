import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Actor } from "../shared/actor.ts";
import type { EntryId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import type { TimeZone } from "../time/time-zone.port.ts";
import {
  type EntryRecord,
  type EntryValueInput,
  exceedsNoteLimit,
  isWellFormedNote,
  normalizeNote,
  requestFingerprint,
} from "./entry.ts";
import { type EntryValueError, validateEntryValue } from "./entry-value.ts";
import { loadMutableEntry, type OwnEntryError } from "./own-entry.ts";

export interface EditEntryDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly clock: Clock;
  readonly timeZone: TimeZone;
}

/**
 * The entry's new state. Both fields are required, so nothing is silently
 * kept or dropped: pass the current value or note to leave it as it is,
 * and `null` to clear the note. The opportunity day never changes.
 */
export interface EditEntryInput {
  readonly entryId: EntryId;
  readonly value: EntryValueInput;
  readonly note: string | null;
}

export type EditEntryError =
  | OwnEntryError
  | EntryValueError
  | { readonly kind: "NoteTooLong" }
  | { readonly kind: "InvalidNote" };

export interface EditEntryResult {
  readonly entry: EntryRecord;
}

/**
 * Edits `actor`'s own Entry while its window is open (ER-10..ER-13, A9,
 * B8), validating the new value and note exactly like `recordEntry` (an
 * empty note is stored as null). Keeps the id, day, `recordedOn`,
 * `recordedAt` and idempotency key and stamps `editedAt`. An edit that
 * changes nothing is a no-op. Fails with `ConcurrencyConflict` if the
 * entry was edited meanwhile (version check) or the membership or season
 * read here changed before commit (D5).
 */
export async function editEntry(
  deps: EditEntryDeps,
  actor: Actor,
  input: EditEntryInput,
): Promise<Result<EditEntryResult, EditEntryError>> {
  return deps.uow.transaction(async (repos): Promise<Result<EditEntryResult, EditEntryError>> => {
    const loaded = await loadMutableEntry(deps, repos, actor, input.entryId);
    if (!loaded.ok) {
      return loaded;
    }
    const { entry, season, circle, commitment } = loaded.value;

    const value = validateEntryValue(commitment.measure, input.value);
    if (!value.ok) {
      return value;
    }
    const note = normalizeNote(input.note);
    if (!isWellFormedNote(note)) {
      return err({ kind: "InvalidNote" });
    }
    if (exceedsNoteLimit(note)) {
      return err({ kind: "NoteTooLong" });
    }

    // Nothing changes: no write, no version bump, no editedAt. Like a pure
    // replay it is not guarded either, unrelated bumps must not conflict.
    if (requestFingerprint(value.value, note) === requestFingerprint(entry.value, entry.note)) {
      return ok({ entry });
    }

    await repos.circles.guardVersion(circle.id, circle.version);
    await repos.seasons.guardVersion(season.id, season.version);

    const edited: EntryRecord = {
      ...entry,
      value: value.value,
      note,
      editedAt: deps.clock.now(),
      version: entry.version + 1,
    };
    await repos.entries.replace(edited, entry.version);
    return ok({ entry: edited });
  });
}
