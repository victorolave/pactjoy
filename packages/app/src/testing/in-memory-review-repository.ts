import type { ReviewRepository } from "../review/review.repository.ts";
import type { ReviewRecord } from "../review/review.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import type { ReviewId } from "../shared/ids.ts";

/** The natural key a member's review of one period is unique on. */
function keyOf(record: ReviewRecord): string {
  return `${record.seasonId}|${record.memberId}|${record.periodIndex}`;
}

interface StagedWrite {
  /** `null` stages a deletion. */
  readonly record: ReviewRecord | null;
  readonly expectedVersion: number | null;
}

/**
 * One isolated transaction's view of the repository, plus its two-phase commit: same
 * `validate()`/`apply()` split as `in-memory-pause-request-repository.ts`, so a `UnitOfWork`
 * spanning several repositories stays atomic.
 */
export interface ReviewTransactionScope {
  readonly repository: ReviewRepository;
  /** @throws {ConcurrencyConflict} if a staged write no longer fits the live store (version or key). Does not mutate. */
  validate(): void;
  /** Applies every staged write to the live store. Callers MUST call `validate()` first. */
  apply(): void;
}

export interface InMemoryReviewRepository extends ReviewRepository {
  beginTransaction(): ReviewTransactionScope;
}

type Store = ReadonlyMap<ReviewId, ReviewRecord>;

function listMine(store: Store, seasonId: string, memberId: string): ReviewRecord[] {
  return [...store.values()]
    .filter((r) => r.seasonId === seasonId && r.memberId === memberId)
    .sort((a, b) => a.periodIndex - b.periodIndex);
}

/** True when another record already holds this record's `(season, member, period)` key. */
function keyTaken(store: Store, record: ReviewRecord): boolean {
  const key = keyOf(record);
  for (const other of store.values()) {
    if (other.id !== record.id && keyOf(other) === key) return true;
  }
  return false;
}

/**
 * Deterministic in-memory {@link ReviewRepository} for tests (ADR-0008). Same rules as the
 * database adapter: the id and the `(season, member, period)` key are unique, so a lost double
 * submit surfaces as a {@link ConcurrencyConflict}.
 */
export function createInMemoryReviewRepository(): InMemoryReviewRepository {
  const store = new Map<ReviewId, ReviewRecord>();

  return {
    async listMine(seasonId, memberId) {
      return listMine(store, seasonId, memberId);
    },

    async save(record, expectedVersion) {
      const existing = store.get(record.id);
      if ((existing ? existing.version : null) !== expectedVersion) throw new ConcurrencyConflict();
      if (keyTaken(store, record)) throw new ConcurrencyConflict();
      store.set(record.id, record);
    },

    async deleteByMembers(memberIds) {
      for (const [id, record] of store) {
        if (memberIds.includes(record.memberId)) store.delete(id);
      }
    },

    async deleteBySeasons(seasonIds) {
      for (const [id, record] of store) {
        if (seasonIds.includes(record.seasonId)) store.delete(id);
      }
    },

    beginTransaction(): ReviewTransactionScope {
      const staged = new Map<ReviewId, StagedWrite>();

      function view(): Map<ReviewId, ReviewRecord> {
        const merged = new Map(store);
        for (const [id, { record }] of staged) {
          if (record) merged.set(id, record);
          else merged.delete(id);
        }
        return merged;
      }

      function removeWhere(matches: (record: ReviewRecord) => boolean): void {
        for (const [id, record] of view()) {
          if (!matches(record)) continue;
          const earlier = staged.get(id);
          staged.set(id, {
            record: null,
            expectedVersion: earlier ? earlier.expectedVersion : record.version,
          });
        }
      }

      const repository: ReviewRepository = {
        async listMine(seasonId, memberId) {
          return listMine(view(), seasonId, memberId);
        },
        async save(record, expectedVersion) {
          const earlier = staged.get(record.id);
          const current = earlier ? earlier.record : store.get(record.id);
          if ((current ? current.version : null) !== expectedVersion) {
            throw new ConcurrencyConflict();
          }
          if (keyTaken(view(), record)) throw new ConcurrencyConflict();
          staged.set(record.id, {
            record,
            expectedVersion: earlier ? earlier.expectedVersion : expectedVersion,
          });
        },
        async deleteByMembers(memberIds) {
          removeWhere((record) => memberIds.includes(record.memberId));
        },
        async deleteBySeasons(seasonIds) {
          removeWhere((record) => seasonIds.includes(record.seasonId));
        },
      };

      return {
        repository,
        validate(): void {
          for (const [id, { record, expectedVersion }] of staged) {
            const existing = store.get(id);
            if ((existing ? existing.version : null) !== expectedVersion) {
              throw new ConcurrencyConflict();
            }
            if (record && keyTaken(store, record)) throw new ConcurrencyConflict();
          }
        },
        apply(): void {
          for (const [id, { record }] of staged) {
            if (record) store.set(id, record);
            else store.delete(id);
          }
        },
      };
    },
  };
}
