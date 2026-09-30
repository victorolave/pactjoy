import type { CommitmentId, MemberId } from "@pactjoy/engine";
import type { EntryId, SeasonId } from "../shared/ids.ts";
import type { EntryRecord, StoredEntry } from "./entry.ts";

/**
 * Storage port for {@link EntryRecord} (ADR-0008, D6). Entries are the
 * source of truth for scoring and are never stored aggregated. Tested
 * through its in-memory adapter (`testing/in-memory-entry-repository.ts`).
 */
export interface EntryRepository {
  /**
   * T1: the entry already recorded under this idempotency key, if any. With
   * `getStored`, the ONLY reads that also return tombstones (`deleted: true`).
   * The key (member, commitment, clientRequestId) is unique across live
   * entries AND tombstones: no partial unique index `WHERE NOT deleted`,
   * or a deleted entry's key would become free again.
   */
  findByClientRequest(
    memberId: MemberId,
    commitmentId: CommitmentId,
    clientRequestId: string,
  ): Promise<StoredEntry | null>;
  /**
   * Like {@link get} but also returns a tombstone, for the owner's idempotent
   * delete. Callers MUST check ownership before revealing `deleted`: anyone
   * else must not learn that an entry existed and was deleted.
   */
  getStored(id: EntryId): Promise<StoredEntry | null>;
  /**
   * `get` and `listBySeason` MUST exclude tombstones (`WHERE NOT deleted`).
   * This is a binding contract for every adapter: scoring and all reads
   * rely on it and never check `deleted` themselves.
   */
  get(id: EntryId): Promise<EntryRecord | null>;
  listBySeason(seasonId: SeasonId): Promise<readonly EntryRecord[]>;
  /**
   * Inserts a new entry. The (member, commitment, clientRequestId) key is
   * unique (T1), so a concurrent duplicate loses the race.
   * @throws {ConcurrencyConflict} if the id or the idempotency key is already stored.
   */
  add(entry: EntryRecord): Promise<void>;
  /**
   * Replaces an entry's mutable fields (value, note, editedAt) and bumps its
   * version: `next.version` must be `expectedVersion + 1` and every other
   * field must equal the stored one (both are caller bugs, thrown as plain
   * errors). A relational adapter runs one UPDATE of only the mutable
   * columns `WHERE id = $id AND version = $expected AND NOT deleted` and
   * checks the affected-row count.
   * @throws {ConcurrencyConflict} if the stored version is no longer `expectedVersion`, or the entry is gone or deleted.
   */
  replace(next: EntryRecord, expectedVersion: number): Promise<void>;
  /**
   * Deletes an entry by turning it into a tombstone (`deleted = true`,
   * `value` and `note` blanked to null, `version = expectedVersion + 1`),
   * so its idempotency key stays taken. A relational adapter runs
   * `UPDATE ... SET deleted = true, value = NULL, note = NULL, version =
   * version + 1 WHERE id = $id AND version = $expected AND NOT deleted` and
   * checks the affected-row count.
   * @throws {ConcurrencyConflict} if the stored version is no longer `expectedVersion`, or the entry is gone or already deleted.
   */
  remove(id: EntryId, expectedVersion: number): Promise<void>;
}
