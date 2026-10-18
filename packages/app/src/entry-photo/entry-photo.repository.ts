import type { MemberId } from "@pactjoy/engine";
import type { EntryPhotoId, SeasonId } from "../shared/ids.ts";
import type { Instant } from "../time/instant.ts";
import type { EntryPhoto } from "./entry-photo.ts";

/**
 * Storage port for the upload ledger ({@link EntryPhoto}, ADR-0016). It is NOT a read model:
 * `repos.entryPhotos` is confined to `src/entry-photo/` (`entry-photo-guard.test.ts`), because a row
 * carries the object key and the reservation state, and neither may reach a peer.
 */
export interface EntryPhotoRepository {
  get(id: EntryPhotoId): Promise<EntryPhoto | null>;
  /** The photos that exist among `ids`, once each, in no particular order. Unknown ids are skipped. */
  getMany(ids: readonly EntryPhotoId[]): Promise<readonly EntryPhoto[]>;
  /**
   * Inserts a new row.
   * @throws {ConcurrencyConflict} if the id or the object key is already stored.
   */
  add(photo: EntryPhoto): Promise<void>;
  /**
   * Moves a row's `status` and bumps its version: `next.version` must be `expectedVersion + 1` and
   * every other field must equal the stored one (both are caller bugs, thrown as plain errors). A
   * relational adapter runs one UPDATE of `status` and `version` only, `WHERE id = $id AND version =
   * $expected`, and never touches a key column.
   * @throws {ConcurrencyConflict} if the stored version is no longer `expectedVersion`, or the row is gone.
   */
  save(next: EntryPhoto, expectedVersion: number): Promise<void>;
  /**
   * How many of the member's reservations are `pending` and were created after `liveSince`, i.e. whose
   * upload URL can still be used (REQ-U5, U7). The caller passes `now - upload URL TTL`: a reservation
   * whose URL is dead no longer counts although its `attachBy` window is still open.
   */
  countOpen(memberId: MemberId, liveSince: Instant): Promise<number>;
  /**
   * Releases up to `limit` `pending` rows whose `attachBy` is at or before `now` (`memberId` null: any
   * member), oldest first, bumping their version, and returns them as released. One UPDATE ... RETURNING
   * on a relational adapter, so concurrent sweeps release disjoint rows.
   */
  releaseExpired(
    memberId: MemberId | null,
    now: Instant,
    limit: number,
  ): Promise<readonly EntryPhoto[]>;
  /** Up to `limit` `released` rows (`memberId` null: any member), oldest first, whose objects still need deleting. */
  listReleased(memberId: MemberId | null, limit: number): Promise<readonly EntryPhoto[]>;
  /** Hard-deletes the `released` rows among `ids`. A pending or attached row is never deleted; unknown ids are ignored. */
  purge(ids: readonly EntryPhotoId[]): Promise<void>;
  /**
   * Account erasure: moves every `pending` and `attached` row of `memberIds` to `released`, bumping
   * its version, and returns them as released so the caller can purge their objects after the commit.
   * Rows already released are left alone and not returned, so a repeat returns `[]`. One UPDATE ...
   * RETURNING on a relational adapter. The entries' own links are cleared by `eraseEvidence`.
   */
  releaseAllOfMembers(memberIds: readonly MemberId[]): Promise<readonly EntryPhoto[]>;
  /**
   * Full-circle erasure: deletes every row of `seasonIds` whatever its status and returns them, so the
   * caller can delete their objects after the commit. The entries that point at them must be deleted
   * first (the foreign key is RESTRICT). `[]` is a no-op.
   */
  deleteBySeasons(seasonIds: readonly SeasonId[]): Promise<readonly EntryPhoto[]>;
}
