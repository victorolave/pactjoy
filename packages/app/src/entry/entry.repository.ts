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
   * Edits an entry's mutable fields (value, note, editedAt) as a
   * compare-and-swap: it only applies if the stored entry still has the
   * value, note and editedAt of `previous`, the state the caller read. A
   * relational adapter expresses that as a conditional UPDATE and checks
   * the affected-row count.
   * @throws {ConcurrencyConflict} if the entry was edited or removed since `previous` was read.
   */
  replace(next: EntryRecord, previous: EntryRecord): Promise<void>;
}
