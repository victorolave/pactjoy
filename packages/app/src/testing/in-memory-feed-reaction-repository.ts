import type { FeedReactionRepository } from "../reaction/feed-reaction.repository.ts";
import type { FeedReaction } from "../reaction/feed-reaction.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import type { FeedReactionId } from "../shared/ids.ts";

/** The natural key a member's reaction to one item is unique on. */
function keyOf(reaction: FeedReaction): string {
  return `${reaction.seasonId}|${reaction.itemKey}|${reaction.memberId}`;
}

interface StagedWrite {
  /** The reaction to store, or `null` to remove the stored one. */
  readonly reaction: FeedReaction | null;
  readonly expectedVersion: number | null;
}

/**
 * One isolated transaction's view of the repository, plus its two-phase commit: same
 * `validate()`/`apply()` split as `in-memory-review-repository.ts`, so a `UnitOfWork`
 * spanning several repositories stays atomic.
 */
export interface FeedReactionTransactionScope {
  readonly repository: FeedReactionRepository;
  /** @throws {ConcurrencyConflict} if a staged write no longer fits the live store (version or key). Does not mutate. */
  validate(): void;
  /** Applies every staged write to the live store. Callers MUST call `validate()` first. */
  apply(): void;
}

export interface InMemoryFeedReactionRepository extends FeedReactionRepository {
  beginTransaction(): FeedReactionTransactionScope;
}

type Store = ReadonlyMap<FeedReactionId, FeedReaction>;

function listBySeason(store: Store, seasonId: string): FeedReaction[] {
  return [...store.values()]
    .filter((r) => r.seasonId === seasonId)
    .sort((a, b) => a.reactedAt - b.reactedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function find(store: Store, seasonId: string, itemKey: string, memberId: string) {
  for (const r of store.values()) {
    if (r.seasonId === seasonId && r.itemKey === itemKey && r.memberId === memberId) return r;
  }
  return null;
}

/** True when another reaction already holds this reaction's `(season, item, member)` key. */
function keyTaken(store: Store, reaction: FeedReaction): boolean {
  const key = keyOf(reaction);
  for (const other of store.values()) {
    if (other.id !== reaction.id && keyOf(other) === key) return true;
  }
  return false;
}

/** The store after a set of staged writes (a `null` reaction removes the row). */
function applied(store: Store, staged: ReadonlyMap<FeedReactionId, StagedWrite>) {
  const merged = new Map(store);
  for (const [id, { reaction }] of staged) {
    if (reaction === null) merged.delete(id);
    else merged.set(id, reaction);
  }
  return merged;
}

/**
 * Deterministic in-memory {@link FeedReactionRepository} for tests (ADR-0008). Same rules as the
 * database adapter: the id and the `(season, item, member)` key are unique, so a lost double set
 * surfaces as a {@link ConcurrencyConflict}.
 */
export function createInMemoryFeedReactionRepository(): InMemoryFeedReactionRepository {
  const store = new Map<FeedReactionId, FeedReaction>();

  return {
    async listBySeason(seasonId) {
      return listBySeason(store, seasonId);
    },

    async find(seasonId, itemKey, memberId) {
      return find(store, seasonId, itemKey, memberId);
    },

    async save(reaction, expectedVersion) {
      const existing = store.get(reaction.id);
      if ((existing ? existing.version : null) !== expectedVersion) throw new ConcurrencyConflict();
      if (keyTaken(store, reaction)) throw new ConcurrencyConflict();
      store.set(reaction.id, reaction);
    },

    async remove(id, expectedVersion) {
      const existing = store.get(id);
      if (!existing || existing.version !== expectedVersion) throw new ConcurrencyConflict();
      store.delete(id);
    },

    beginTransaction(): FeedReactionTransactionScope {
      const staged = new Map<FeedReactionId, StagedWrite>();

      /** What this scope sees of one id: its own staged write over the live store. */
      function current(id: FeedReactionId): FeedReaction | undefined {
        const write = staged.get(id);
        return write ? (write.reaction ?? undefined) : store.get(id);
      }

      const repository: FeedReactionRepository = {
        async listBySeason(seasonId) {
          return listBySeason(applied(store, staged), seasonId);
        },
        async find(seasonId, itemKey, memberId) {
          return find(applied(store, staged), seasonId, itemKey, memberId);
        },
        async save(reaction, expectedVersion) {
          const seen = current(reaction.id);
          if ((seen ? seen.version : null) !== expectedVersion) throw new ConcurrencyConflict();
          if (keyTaken(applied(store, staged), reaction)) throw new ConcurrencyConflict();
          const earlier = staged.get(reaction.id);
          staged.set(reaction.id, {
            reaction,
            expectedVersion: earlier ? earlier.expectedVersion : expectedVersion,
          });
        },
        async remove(id, expectedVersion) {
          const seen = current(id);
          if (!seen || seen.version !== expectedVersion) throw new ConcurrencyConflict();
          const earlier = staged.get(id);
          // Removing what this very scope inserted leaves nothing to apply.
          if (earlier && earlier.expectedVersion === null) staged.delete(id);
          else
            staged.set(id, {
              reaction: null,
              expectedVersion: earlier?.expectedVersion ?? expectedVersion,
            });
        },
      };

      return {
        repository,
        validate(): void {
          const after = applied(store, staged);
          for (const [id, { reaction, expectedVersion }] of staged) {
            const existing = store.get(id);
            if ((existing ? existing.version : null) !== expectedVersion) {
              throw new ConcurrencyConflict();
            }
            if (reaction !== null && keyTaken(after, reaction)) throw new ConcurrencyConflict();
          }
        },
        apply(): void {
          for (const [id, { reaction }] of staged) {
            if (reaction === null) store.delete(id);
            else store.set(id, reaction);
          }
        },
      };
    },
  };
}
