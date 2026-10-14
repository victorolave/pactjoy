import type { MemberId } from "@pactjoy/engine";
import type { EntryPhoto } from "../entry-photo/entry-photo.ts";
import type { PhotoError } from "../entry-photo/errors.ts";
import {
  attachPhoto,
  purgeReleased,
  releasePhoto,
  verifyUploadedPhoto,
} from "../entry-photo/photo-lifecycle.ts";
import type { EvidenceStorage } from "../ports/evidence-storage.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Actor } from "../shared/actor.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import type { EntryId, EntryPhotoId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import type { TimeZone } from "../time/time-zone.port.ts";
import {
  type EntryRecord,
  type EntryValueInput,
  exceedsNoteLimit,
  isStorableNote,
  normalizeNote,
  requestFingerprint,
} from "./entry.ts";
import { type EntryValueError, validateEntryValue } from "./entry-value.ts";
import { isPaused } from "./on-hold.ts";
import { loadMutableEntry, type OwnEntryError } from "./own-entry.ts";

export interface EditEntryDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly clock: Clock;
  readonly timeZone: TimeZone;
  /** Only touched when the edit adds, replaces or removes a photo (ADR-0016). */
  readonly evidence: EvidenceStorage;
}

/**
 * The entry's new state. `value` and `note` are required, so nothing is
 * silently kept or dropped: pass the current value or note to leave it as it
 * is, and `null` to clear the note. The opportunity day never changes.
 *
 * `photoId` is the one optional field, on purpose (an old cached client does
 * not send it): omitted, or the current id, KEEPS the photo; `null` removes
 * it; a new id replaces it. Editing to `missed` releases the photo, because a
 * `missed` entry never carries one: only the current id (or nothing, or
 * `null`) may accompany that edit.
 */
export interface EditEntryInput {
  readonly entryId: EntryId;
  readonly value: EntryValueInput;
  readonly note: string | null;
  readonly photoId?: EntryPhotoId | null;
}

export type EditEntryError =
  | OwnEntryError
  | EntryValueError
  | { readonly kind: "OpportunityPaused" }
  | { readonly kind: "NoteTooLong" }
  | { readonly kind: "InvalidNote" }
  | Exclude<PhotoError, { kind: "TooManyPhotoUploads" }>;

export interface EditEntryResult {
  readonly entry: EntryRecord;
  /** The actor's own member id, from the transaction that edited (the acting member). */
  readonly memberId: MemberId;
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
  const requested = input.photoId;
  if (input.value.kind === "missed" && requested) {
    // Only the CURRENT photo may ride along (it is released). Decided before any storage I/O.
    const current = await deps.uow.read(({ entries }) => entries.getStored(input.entryId));
    if (current && !current.deleted && current.photoId !== requested) {
      return err({ kind: "PhotoNotAllowedOnMissed" });
    }
  }
  // A photo to attach is checked OUTSIDE the transaction (storage I/O, and `work` may run twice).
  // The entry's own current photo is `attached`, so this does not touch storage for a keep.
  let verifiedVersion: number | null = null;
  if (requested && input.value.kind !== "missed") {
    const verified = await verifyUploadedPhoto(deps, actor, requested);
    if (!verified.ok) {
      return verified;
    }
    verifiedVersion = verified.value.version;
  }

  const edited = await deps.uow.transaction(
    async (
      repos,
    ): Promise<
      Result<{ result: EditEntryResult; released: readonly EntryPhoto[] }, EditEntryError>
    > => {
      const loaded = await loadMutableEntry(deps, repos, actor, input.entryId);
      if (!loaded.ok) {
        return loaded;
      }
      const { entry, season, circle, commitment, memberId, pauses, today } = loaded.value;

      // An Entry on a day an approved Pause covers cannot be changed; deleting it stays allowed.
      if (
        season.actualStart !== null &&
        isPaused({
          season,
          actualStart: season.actualStart,
          commitment,
          day: entry.day,
          today,
          pauses,
        })
      ) {
        return err({ kind: "OpportunityPaused" });
      }

      const value = validateEntryValue(commitment.measure, input.value);
      if (!value.ok) {
        return value;
      }
      const note = normalizeNote(input.note);
      if (!isStorableNote(note)) {
        return err({ kind: "InvalidNote" });
      }
      if (exceedsNoteLimit(note)) {
        return err({ kind: "NoteTooLong" });
      }

      const isMissed = value.value.kind === "missed";
      if (isMissed && requested && requested !== entry.photoId) {
        return err({ kind: "PhotoNotAllowedOnMissed" });
      }
      // The photo the entry ends up with: `missed` never has one; no `photoId` means keep.
      const target: EntryPhotoId | null = isMissed
        ? null
        : requested === undefined
          ? entry.photoId
          : requested;

      // Nothing changes: no write, no version bump, no editedAt. Like a pure
      // replay it is not guarded either, unrelated bumps must not conflict.
      if (
        requestFingerprint(value.value, note, target) ===
        requestFingerprint(entry.value, entry.note, entry.photoId)
      ) {
        return ok({ result: { entry, memberId }, released: [] });
      }

      await repos.circles.guardVersion(circle.id, circle.version);
      await repos.seasons.guardVersion(season.id, season.version);

      const released: EntryPhoto[] = [];
      if (target !== entry.photoId) {
        if (target !== null) {
          if (verifiedVersion === null) {
            throw new ConcurrencyConflict();
          }
          const attached = await attachPhoto(repos, {
            photoId: target,
            verifiedVersion,
            memberId,
            seasonId: season.id,
            commitmentId: commitment.id,
            now: deps.clock.now(),
          });
          if (!attached.ok) {
            return attached;
          }
        }
        if (entry.photoId !== null) {
          const old = await releasePhoto(repos, entry.photoId);
          if (old) {
            released.push(old);
          }
        }
      }

      const next: EntryRecord = {
        ...entry,
        value: value.value,
        note,
        photoId: target,
        editedAt: deps.clock.now(),
        version: entry.version + 1,
      };
      await repos.entries.replace(next, entry.version);
      return ok({ result: { entry: next, memberId }, released });
    },
  );
  if (!edited.ok) {
    return edited;
  }
  // After the commit, best effort: a failure leaves the row `released` for the next sweep.
  await purgeReleased(deps, edited.value.released);
  return ok(edited.value.result);
}
