import type { EncouragementRepository } from "../encouragement/encouragement.repository.ts";
import type { Encouragement } from "../encouragement/encouragement.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import type { EncouragementId } from "../shared/ids.ts";

/** The two natural keys the database holds unique (ADR-0018, F14). */
function caseKeyOf(e: Encouragement): string {
  return `${e.seasonId}|${e.senderId}|${e.recipientId}|${e.caseWeek}`;
}
function dayKeyOf(e: Encouragement): string {
  return `${e.senderId}|${e.recipientId}|${e.sentOn}`;
}

/**
 * One isolated transaction's view of the repository, plus its two-phase commit: same
 * `validate()`/`apply()` split as `in-memory-review-repository.ts`, so a `UnitOfWork`
 * spanning several repositories stays atomic.
 */
export interface EncouragementTransactionScope {
  readonly repository: EncouragementRepository;
  /** @throws {ConcurrencyConflict} if a staged write no longer fits the live store (id or a unique key). Does not mutate. */
  validate(): void;
  /** Applies every staged write to the live store. Callers MUST call `validate()` first. */
  apply(): void;
}

export interface InMemoryEncouragementRepository extends EncouragementRepository {
  beginTransaction(): EncouragementTransactionScope;
}

type Store = ReadonlyMap<EncouragementId, Encouragement>;

const oldestFirst = (a: Encouragement, b: Encouragement) =>
  a.sentAt - b.sentAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** True when the store already holds this encouragement's id or either of its unique keys. */
function conflicts(store: Store, e: Encouragement): boolean {
  if (store.has(e.id)) return true;
  for (const other of store.values()) {
    if (caseKeyOf(other) === caseKeyOf(e) || dayKeyOf(other) === dayKeyOf(e)) return true;
  }
  return false;
}

function read(store: Store): Omit<EncouragementRepository, "add"> {
  return {
    async listSent(seasonId, senderId) {
      return [...store.values()]
        .filter((e) => e.seasonId === seasonId && e.senderId === senderId)
        .sort(oldestFirst);
    },
    async listReceived(seasonId, recipientId) {
      return [...store.values()]
        .filter((e) => e.seasonId === seasonId && e.recipientId === recipientId)
        .sort(oldestFirst);
    },
    async get(id) {
      return store.get(id) ?? null;
    },
  };
}

/**
 * Deterministic in-memory {@link EncouragementRepository} for tests (ADR-0008). Same rules as the
 * database adapter: the id and both unique keys are enforced, so a lost double send surfaces as a
 * {@link ConcurrencyConflict}.
 */
export function createInMemoryEncouragementRepository(): InMemoryEncouragementRepository {
  const store = new Map<EncouragementId, Encouragement>();
  const reads = read(store);

  return {
    ...reads,

    async add(encouragement) {
      if (conflicts(store, encouragement)) throw new ConcurrencyConflict();
      store.set(encouragement.id, encouragement);
    },

    beginTransaction(): EncouragementTransactionScope {
      const staged = new Map<EncouragementId, Encouragement>();

      function view(): Map<EncouragementId, Encouragement> {
        return new Map([...store, ...staged]);
      }

      const repository: EncouragementRepository = {
        listSent: (seasonId, senderId) => read(view()).listSent(seasonId, senderId),
        listReceived: (seasonId, recipientId) => read(view()).listReceived(seasonId, recipientId),
        get: (id) => read(view()).get(id),
        async add(encouragement) {
          if (conflicts(view(), encouragement)) throw new ConcurrencyConflict();
          staged.set(encouragement.id, encouragement);
        },
      };

      return {
        repository,
        validate(): void {
          // A staged row must not meet a row committed meanwhile (id or either unique key).
          for (const encouragement of staged.values()) {
            if (conflicts(store, encouragement)) throw new ConcurrencyConflict();
          }
        },
        apply(): void {
          for (const [id, encouragement] of staged) store.set(id, encouragement);
        },
      };
    },
  };
}
