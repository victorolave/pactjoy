import type { ReviewRepository } from "../review/review.repository.ts";
import type { ReviewRecord } from "../review/review.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import type { ReviewId } from "../shared/ids.ts";

/** The natural key a member's review of one period is unique on. */
function keyOf(record: ReviewRecord): string {
  return `${record.seasonId}|${record.memberId}|${record.periodIndex}`;
}

/**
 * Deterministic in-memory {@link ReviewRepository} for tests (ADR-0008). Same rules as the
 * database adapter: the id and the `(season, member, period)` key are unique, so a lost double
 * submit surfaces as a {@link ConcurrencyConflict}.
 */
export function createInMemoryReviewRepository(): ReviewRepository {
  const store = new Map<ReviewId, ReviewRecord>();

  return {
    async listMine(seasonId, memberId) {
      return [...store.values()]
        .filter((r) => r.seasonId === seasonId && r.memberId === memberId)
        .sort((a, b) => a.periodIndex - b.periodIndex);
    },

    async save(record, expectedVersion) {
      const existing = store.get(record.id);
      if ((existing ? existing.version : null) !== expectedVersion) throw new ConcurrencyConflict();
      const key = keyOf(record);
      for (const other of store.values()) {
        if (other.id !== record.id && keyOf(other) === key) throw new ConcurrencyConflict();
      }
      store.set(record.id, record);
    },
  };
}
