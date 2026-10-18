import type { HabitRepository } from "../habit/habit.repository.ts";
import type { Habit } from "../habit/habit.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import type { HabitId, UserId } from "../shared/ids.ts";

interface StagedWrite {
  /** `null` stages a deletion. */
  readonly habit: Habit | null;
  readonly expectedVersion: number | null;
}

/**
 * One isolated transaction's view of the repository, plus its two-phase
 * commit (ADR-0008, D4/D5), same `validate()`/`apply()` split as
 * `in-memory-circle-repository.ts` -- see its docstring for why a UnitOfWork
 * spanning multiple repositories needs the two calls separated.
 */
export interface HabitTransactionScope {
  /**
   * Reads see this scope's own staged writes layered over the live store
   * (read-your-own-writes); `save()` only stages a write -- it never
   * mutates the live store and never throws on a version mismatch (that
   * check is `validate()`'s job).
   */
  readonly repository: HabitRepository;
  /** @throws {ConcurrencyConflict} if any staged write's `expectedVersion` no longer matches the live store. Does not mutate. */
  validate(): void;
  /** Applies every staged write to the live store. Callers MUST call `validate()` first (see docstring above). */
  apply(): void;
}

export interface InMemoryHabitRepository extends HabitRepository {
  beginTransaction(): HabitTransactionScope;
}

/** Deterministic in-memory {@link HabitRepository} for tests (ADR-0008). */
export function createInMemoryHabitRepository(): InMemoryHabitRepository {
  const store = new Map<HabitId, Habit>();

  function pick(ids: readonly HabitId[], read: (id: HabitId) => Habit | null): readonly Habit[] {
    const found: Habit[] = [];
    for (const id of new Set(ids)) {
      const habit = read(id);
      if (habit) found.push(habit);
    }
    return found;
  }

  const newestFirst = (a: Habit, b: Habit) =>
    b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  return {
    async get(id: HabitId): Promise<Habit | null> {
      return store.get(id) ?? null;
    },

    async listByOwner(ownerId: UserId): Promise<readonly Habit[]> {
      return [...store.values()].filter((h) => h.ownerId === ownerId).sort(newestFirst);
    },

    async getMany(ids: readonly HabitId[]): Promise<readonly Habit[]> {
      return pick(ids, (id) => store.get(id) ?? null);
    },

    async deleteByOwner(ownerId: UserId): Promise<void> {
      for (const [id, habit] of store) {
        if (habit.ownerId === ownerId) store.delete(id);
      }
    },

    async save(habit: Habit, expectedVersion: number | null): Promise<void> {
      const existing = store.get(habit.id);
      const currentVersion = existing ? existing.version : null;
      if (currentVersion !== expectedVersion) {
        throw new ConcurrencyConflict();
      }
      store.set(habit.id, habit);
    },

    beginTransaction(): HabitTransactionScope {
      const staged = new Map<HabitId, StagedWrite>();

      function view(id: HabitId): Habit | null {
        const write = staged.get(id);
        return write ? write.habit : (store.get(id) ?? null);
      }

      function merged(): Map<HabitId, Habit> {
        const all = new Map(store);
        for (const [id, { habit }] of staged) {
          if (habit) all.set(id, habit);
          else all.delete(id);
        }
        return all;
      }

      const repository: HabitRepository = {
        async get(id: HabitId): Promise<Habit | null> {
          return view(id);
        },

        async getMany(ids: readonly HabitId[]): Promise<readonly Habit[]> {
          return pick(ids, view);
        },

        async listByOwner(ownerId: UserId): Promise<readonly Habit[]> {
          return [...merged().values()].filter((h) => h.ownerId === ownerId).sort(newestFirst);
        },

        async deleteByOwner(ownerId: UserId): Promise<void> {
          for (const [id, habit] of merged()) {
            if (habit.ownerId !== ownerId) continue;
            const earlier = staged.get(id);
            staged.set(id, {
              habit: null,
              expectedVersion: earlier ? earlier.expectedVersion : habit.version,
            });
          }
        },

        async save(habit: Habit, expectedVersion: number | null): Promise<void> {
          staged.set(habit.id, { habit, expectedVersion });
        },
      };

      return {
        repository,
        validate(): void {
          for (const [id, { expectedVersion }] of staged) {
            const existing = store.get(id);
            const currentVersion = existing ? existing.version : null;
            if (currentVersion !== expectedVersion) {
              throw new ConcurrencyConflict();
            }
          }
        },
        apply(): void {
          for (const [id, { habit }] of staged) {
            if (habit) store.set(id, habit);
            else store.delete(id);
          }
        },
      };
    },
  };
}
