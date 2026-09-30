import type { CommitmentId, MemberId } from "@pactjoy/engine";
import type { EntryId, SeasonId } from "../shared/ids.ts";
import type { EntryRecord } from "./entry.ts";

/**
 * Storage port for {@link EntryRecord} (ADR-0008, D6). Entries are the
 * source of truth for scoring and are never stored aggregated. Tested
 * through its in-memory adapter (`testing/in-memory-entry-repository.ts`).
 */
export interface EntryRepository {
  /** T1: the entry already recorded under this idempotency key, if any. */
  findByClientRequest(
    memberId: MemberId,
    commitmentId: CommitmentId,
    clientRequestId: string,
  ): Promise<EntryRecord | null>;
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
   * columns `WHERE id = $id AND version = $expected` and checks the
   * affected-row count.
   * @throws {ConcurrencyConflict} if the stored version is no longer `expectedVersion`, or the entry is gone.
   */
  replace(next: EntryRecord, expectedVersion: number): Promise<void>;
  /**
   * Deletes an entry, with the same version check as {@link replace}
   * (`DELETE ... WHERE id = $id AND version = $expected`).
   * @throws {ConcurrencyConflict} if the stored version is no longer `expectedVersion`, or the entry is gone.
   */
  remove(id: EntryId, expectedVersion: number): Promise<void>;
}
