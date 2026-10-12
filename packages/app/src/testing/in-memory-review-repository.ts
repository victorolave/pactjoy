import type { ReviewRepository } from "../review/review.repository.ts";
import type { ReviewRecord } from "../review/review.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import type { ReviewId } from "../shared/ids.ts";

/** The natural key a member's review of one period is unique on. */
function keyOf(record: ReviewRecord): string {
  return `${record.seasonId}|${record.memberId}|${record.periodIndex}`;
}

interface StagedWrite {
  readonly record: ReviewRecord;
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

    beginTransaction(): ReviewTransactionScope {
      const staged = new Map<ReviewId, StagedWrite>();

      function view(): Map<ReviewId, ReviewRecord> {
        const merged = new Map(store);
        for (const [id, { record }] of staged) merged.set(id, record);
        return merged;
      }

      const repository: ReviewRepository = {
        async listMine(seasonId, memberId) {
          return listMine(view(), seasonId, memberId);
        },
        async save(record, expectedVersion) {
          const current = staged.get(record.id)?.record ?? store.get(record.id);
          if ((current ? current.version : null) !== expectedVersion) {
            throw new ConcurrencyConflict();
          }
          if (keyTaken(view(), record)) throw new ConcurrencyConflict();
          const earlier = staged.get(record.id);
          staged.set(record.id, {
            record,
            expectedVersion: earlier ? earlier.expectedVersion : expectedVersion,
          });
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
            if (keyTaken(store, record)) throw new ConcurrencyConflict();
          }
        },
        apply(): void {
          for (const [id, { record }] of staged) store.set(id, record);
        },
      };
    },
  };
}
