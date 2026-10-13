import type { CommitmentId, MemberId } from "@pactjoy/engine";
import { findActiveMember } from "../circle/circle.ts";
import type { EvidenceStorage } from "../ports/evidence-storage.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Actor } from "../shared/actor.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import type { EntryPhotoId, SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { Instant } from "../time/instant.ts";
import type { EntryPhoto } from "./entry-photo.ts";
import type { PhotoError } from "./errors.ts";

/** The first three bytes of every JPEG. */
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;

export type VerifyPhotoError = Extract<
  PhotoError,
  {
    kind:
      | "PhotoNotFound"
      | "PhotoNotUploaded"
      | "PhotoNotAvailable"
      | "PhotoUploadExpired"
      | "InvalidPhoto";
  }
>;

export interface VerifyPhotoDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly clock: { now(): Instant };
  readonly evidence: EvidenceStorage;
}

/**
 * Checks, OUTSIDE any transaction (storage I/O must not hold row locks, and a unit of work's `work`
 * may run twice), that `actor` may attach `photoId` and that the stored object is what was reserved:
 * the size, `image/jpeg`, and a JPEG signature in its first bytes.
 *
 * An already `attached` photo is not looked at in storage: the transaction decides what that means
 * (the current photo of an Entry being edited, an idempotent replay, or a double attach). The
 * returned `version` is the one `attachPhoto` must still find, which closes the gap between this
 * check and the commit.
 */
export async function verifyUploadedPhoto(
  deps: VerifyPhotoDeps,
  actor: Actor,
  id: EntryPhotoId,
): Promise<Result<{ readonly version: number }, VerifyPhotoError>> {
  const photo = await deps.uow.read(async (repos) => {
    const found = await repos.entryPhotos.get(id);
    if (!found) return null;
    const season = await repos.seasons.get(found.seasonId);
    const circle = season ? await repos.circles.get(season.circleId) : null;
    const member = circle ? findActiveMember(circle, actor.userId) : undefined;
    // Somebody else's photo is indistinguishable from an unknown one.
    return member?.id === found.memberId ? found : null;
  });
  if (!photo) {
    return err({ kind: "PhotoNotFound" });
  }
  if (photo.status === "released") {
    return err({ kind: "PhotoNotAvailable" });
  }
  if (photo.status === "attached") {
    return ok({ version: photo.version });
  }
  if (deps.clock.now() >= photo.attachBy) {
    return err({ kind: "PhotoUploadExpired" });
  }

  const stored = await deps.evidence.stat(photo.objectKey);
  if (!stored) {
    return err({ kind: "PhotoNotUploaded" });
  }
  if (stored.size !== photo.byteSize) {
    return err({ kind: "InvalidPhoto", reason: "sizeMismatch" });
  }
  if (stored.contentType !== "image/jpeg") {
    return err({ kind: "InvalidPhoto", reason: "notJpeg" });
  }
  const head = await deps.evidence.readHead(photo.objectKey, JPEG_SIGNATURE.length);
  if (!head || !JPEG_SIGNATURE.every((byte, index) => head[index] === byte)) {
    return err({ kind: "InvalidPhoto", reason: "notJpeg" });
  }
  return ok({ version: photo.version });
}

export interface AttachPhotoInput {
  readonly photoId: EntryPhotoId;
  /** The version {@link verifyUploadedPhoto} saw. */
  readonly verifiedVersion: number;
  readonly memberId: MemberId;
  readonly seasonId: SeasonId;
  readonly commitmentId: CommitmentId;
  readonly now: Instant;
}

/**
 * INSIDE the transaction: marks the photo `attached` (REQ-A2, A5). It must still be `pending`,
 * unexpired, and reserved by this member for this very commitment (anything else is "not found": a
 * photo from another commitment is not yours to use here). The save is version-checked against what
 * was verified, so two Entries racing for one photo end with one `ConcurrencyConflict`.
 */
export async function attachPhoto(
  repos: Repositories,
  input: AttachPhotoInput,
): Promise<
  Result<
    void,
    Extract<PhotoError, { kind: "PhotoNotFound" | "PhotoNotAvailable" | "PhotoUploadExpired" }>
  >
> {
  const photo = await repos.entryPhotos.get(input.photoId);
  if (
    !photo ||
    photo.memberId !== input.memberId ||
    photo.seasonId !== input.seasonId ||
    photo.commitmentId !== input.commitmentId
  ) {
    return err({ kind: "PhotoNotFound" });
  }
  if (photo.status !== "pending") {
    return err({ kind: "PhotoNotAvailable" });
  }
  if (input.now >= photo.attachBy) {
    return err({ kind: "PhotoUploadExpired" });
  }
  if (photo.version !== input.verifiedVersion) {
    throw new ConcurrencyConflict();
  }
  await repos.entryPhotos.save(
    { ...photo, status: "attached", version: photo.version + 1 },
    photo.version,
  );
  return ok(undefined);
}

/**
 * INSIDE the transaction: gives the photo up (replace, remove, delete, edit to `missed`), returning
 * the released row so the caller can purge it after the commit. Releasing a missing or already
 * released photo is a no-op that returns `null`.
 */
export async function releasePhoto(
  repos: Repositories,
  id: EntryPhotoId,
): Promise<EntryPhoto | null> {
  const photo = await repos.entryPhotos.get(id);
  if (!photo || photo.status === "released") {
    return null;
  }
  const released: EntryPhoto = { ...photo, status: "released", version: photo.version + 1 };
  await repos.entryPhotos.save(released, photo.version);
  return released;
}

export interface PurgeDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly evidence: EvidenceStorage;
}

/**
 * AFTER the commit: deletes the objects of `released` rows, then removes the rows whose object is
 * gone. Every failure is swallowed (REQ-A7): a row whose delete failed simply stays `released` and
 * the next sweep retries it. Returns how many rows were removed.
 */
export async function purgeReleased(
  deps: PurgeDeps,
  photos: readonly EntryPhoto[],
): Promise<number> {
  const deleted: EntryPhotoId[] = [];
  for (const photo of photos) {
    try {
      await deps.evidence.delete(photo.objectKey);
      deleted.push(photo.id);
    } catch {
      // Left released for the next sweep.
    }
  }
  if (deleted.length === 0) {
    return 0;
  }
  try {
    await deps.uow.transaction(async ({ entryPhotos }) => {
      await entryPhotos.purge(deleted);
      return ok(undefined);
    });
    return deleted.length;
  } catch {
    return 0;
  }
}
