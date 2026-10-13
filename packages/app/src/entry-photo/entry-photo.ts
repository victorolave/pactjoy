import type { CommitmentId, MemberId } from "@pactjoy/engine";
import type { EntryPhotoId, SeasonId } from "../shared/ids.ts";
import { type Instant, instant } from "../time/instant.ts";
import { ATTACH_WINDOW_MS, MAX_PHOTO_BYTES } from "./limits.ts";
import { OBJECT_KEY_PATTERN } from "./object-key.ts";

/**
 * `pending`: reserved, the browser may still upload; `attached`: owned by exactly one Entry;
 * `released`: nobody owns it, its object is deleted (or about to be) and the row is purged.
 */
export type EntryPhotoStatus = "pending" | "attached" | "released";

/**
 * One row of the upload ledger (ADR-0016): the reservation of a photo, from the signed upload to
 * the Entry that owns it. The Entry only carries its {@link EntryPhotoId}; `objectKey` and
 * `byteSize` never leave the server (REQ-P3).
 */
export interface EntryPhoto {
  readonly id: EntryPhotoId;
  readonly seasonId: SeasonId;
  readonly memberId: MemberId;
  readonly commitmentId: CommitmentId;
  /** Opaque, minted by `mintObjectKey`; UNIQUE in the ledger. */
  readonly objectKey: string;
  /** The exact size the signed upload pins. */
  readonly byteSize: number;
  readonly status: EntryPhotoStatus;
  readonly createdAt: Instant;
  /** A pending photo cannot be attached from this instant on, and the sweep may release it. */
  readonly attachBy: Instant;
  /** Optimistic version (D5): 0 when reserved, +1 on every status change. */
  readonly version: number;
}

export interface PendingEntryPhotoInput {
  readonly id: EntryPhotoId;
  readonly seasonId: SeasonId;
  readonly memberId: MemberId;
  readonly commitmentId: CommitmentId;
  readonly objectKey: string;
  readonly byteSize: number;
  readonly now: Instant;
}

/**
 * A new reservation. The input checks mirror the table's CHECKs, so a bug fails here with a clear
 * message instead of at the database.
 * @throws {RangeError} if `byteSize` is not an integer in 1..MAX_PHOTO_BYTES or `objectKey` is not a minted key.
 */
export function pendingEntryPhoto(input: PendingEntryPhotoInput): EntryPhoto {
  if (!Number.isInteger(input.byteSize) || input.byteSize < 1 || input.byteSize > MAX_PHOTO_BYTES) {
    throw new RangeError(`pendingEntryPhoto: byteSize must be an integer in 1..${MAX_PHOTO_BYTES}`);
  }
  if (!OBJECT_KEY_PATTERN.test(input.objectKey)) {
    throw new RangeError("pendingEntryPhoto: objectKey is not a minted object key");
  }
  return {
    id: input.id,
    seasonId: input.seasonId,
    memberId: input.memberId,
    commitmentId: input.commitmentId,
    objectKey: input.objectKey,
    byteSize: input.byteSize,
    status: "pending",
    createdAt: input.now,
    attachBy: instant(input.now + ATTACH_WINDOW_MS),
    version: 0,
  };
}

/** Whether the reservation still counts toward the cap and can still be attached (REQ-U7). */
export function isOpenReservation(photo: EntryPhoto, now: Instant): boolean {
  return photo.status === "pending" && now < photo.attachBy;
}
