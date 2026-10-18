import type { SeasonClosureRepository } from "../season/closure/season-closure.repository.ts";
import type { SeasonClosure } from "../season/closure/season-closure.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import type { SeasonClosureId } from "../shared/ids.ts";

/** The natural key a member's closure of one season is unique on. */
function keyOf(closure: SeasonClosure): string {
  return `${closure.seasonId}|${closure.memberId}`;
}

interface StagedWrite {
  readonly closure: SeasonClosure | null;
  readonly expectedVersion: number | null;
}

/**
 * One isolated transaction's view of the repository, plus its two-phase commit: same
 * `validate()`/`apply()` split as `in-memory-review-repository.ts`, so a `UnitOfWork`
 * spanning several repositories stays atomic.
 */
export interface SeasonClosureTransactionScope {
  readonly repository: SeasonClosureRepository;
  /** @throws {ConcurrencyConflict} if a staged write no longer fits the live store (version or key). Does not mutate. */
  validate(): void;
  /** Applies every staged write to the live store. Callers MUST call `validate()` first. */
  apply(): void;
}

export interface InMemorySeasonClosureRepository extends SeasonClosureRepository {
  beginTransaction(): SeasonClosureTransactionScope;
}

type Store = ReadonlyMap<SeasonClosureId, SeasonClosure>;

function getMine(store: Store, seasonId: string, memberId: string): SeasonClosure | null {
  for (const closure of store.values()) {
    if (closure.seasonId === seasonId && closure.memberId === memberId) return closure;
  }
  return null;
}

function closedMemberIds(store: Store, seasonId: string): SeasonClosure["memberId"][] {
  return [...store.values()].filter((c) => c.seasonId === seasonId).map((c) => c.memberId);
}

/** True when another closure already holds this closure's `(season, member)` key. */
function keyTaken(store: Store, closure: SeasonClosure): boolean {
  const key = keyOf(closure);
  for (const other of store.values()) {
    if (other.id !== closure.id && keyOf(other) === key) return true;
  }
  return false;
}

/**
 * Deterministic in-memory {@link SeasonClosureRepository} for tests (ADR-0008). Same rules as the
 * database adapter: the id and the `(season, member)` key are unique, so a lost double submit
 * surfaces as a {@link ConcurrencyConflict}.
 */
export function createInMemorySeasonClosureRepository(): InMemorySeasonClosureRepository {
  const store = new Map<SeasonClosureId, SeasonClosure>();

  return {
    async deleteByMembers(memberIds) {
      for (const [id, closure] of store) {
        if (memberIds.includes(closure.memberId)) store.delete(id);
      }
    },
    async deleteBySeasons(seasonIds) {
      for (const [id, closure] of store) {
        if (seasonIds.includes(closure.seasonId)) store.delete(id);
      }
    },
    async getMine(seasonId, memberId) {
      return getMine(store, seasonId, memberId);
    },

    async closedMemberIds(seasonId) {
      return closedMemberIds(store, seasonId);
    },

    async save(closure, expectedVersion) {
      const existing = store.get(closure.id);
      if ((existing ? existing.version : null) !== expectedVersion) throw new ConcurrencyConflict();
      if (keyTaken(store, closure)) throw new ConcurrencyConflict();
      store.set(closure.id, closure);
    },

    beginTransaction(): SeasonClosureTransactionScope {
      const staged = new Map<SeasonClosureId, StagedWrite>();

      function view(): Map<SeasonClosureId, SeasonClosure> {
        const merged = new Map(store);
        for (const [id, { closure }] of staged) {
          if (closure) merged.set(id, closure);
          else merged.delete(id);
        }
        return merged;
      }

      function removeWhere(matches: (closure: SeasonClosure) => boolean): void {
        for (const [id, closure] of view()) {
          if (!matches(closure)) continue;
          const earlier = staged.get(id);
          staged.set(id, {
            closure: null,
            expectedVersion: earlier ? earlier.expectedVersion : closure.version,
          });
        }
      }

      const repository: SeasonClosureRepository = {
        async deleteByMembers(memberIds) {
          removeWhere((closure) => memberIds.includes(closure.memberId));
        },
        async deleteBySeasons(seasonIds) {
          removeWhere((closure) => seasonIds.includes(closure.seasonId));
        },
        async getMine(seasonId, memberId) {
          return getMine(view(), seasonId, memberId);
        },
        async closedMemberIds(seasonId) {
          return closedMemberIds(view(), seasonId);
        },
        async save(closure, expectedVersion) {
          const earlier = staged.get(closure.id);
          const current = earlier ? earlier.closure : store.get(closure.id);
          if ((current ? current.version : null) !== expectedVersion) {
            throw new ConcurrencyConflict();
          }
          if (keyTaken(view(), closure)) throw new ConcurrencyConflict();
          staged.set(closure.id, {
            closure,
            expectedVersion: earlier ? earlier.expectedVersion : expectedVersion,
          });
        },
      };

      return {
        repository,
        validate(): void {
          for (const [id, { closure, expectedVersion }] of staged) {
            const existing = store.get(id);
            if ((existing ? existing.version : null) !== expectedVersion) {
              throw new ConcurrencyConflict();
            }
            if (closure && keyTaken(store, closure)) throw new ConcurrencyConflict();
          }
        },
        apply(): void {
          for (const [id, { closure }] of staged) {
            if (closure) store.set(id, closure);
            else store.delete(id);
          }
        },
      };
    },
  };
}
