import type { HabitRepository } from "../habit/habit.repository.ts";
import type { Habit } from "../habit/habit.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import type { HabitId } from "../shared/ids.ts";

interface StagedWrite {
  readonly habit: Habit;
  readonly expectedVersion: number | null;
}

/** One isolated transaction's view of the repository, plus its atomic commit (ADR-0008, D4/D5). */
export interface HabitTransactionScope {
  /**
   * Reads see this scope's own staged writes layered over the live store
   * (read-your-own-writes); `save()` only stages a write -- it never
   * mutates the live store and never throws on a version mismatch (that
   * check is deferred to `commit()`), same pattern as
   * `in-memory-circle-repository.ts`.
   */
  readonly repository: HabitRepository;
  /** @throws {ConcurrencyConflict} if any staged write's `expectedVersion` no longer matches the live store. */
  commit(): void;
}

export interface InMemoryHabitRepository extends HabitRepository {
  beginTransaction(): HabitTransactionScope;
}

/** Deterministic in-memory {@link HabitRepository} for tests (ADR-0008). */
export function createInMemoryHabitRepository(): InMemoryHabitRepository {
  const store = new Map<HabitId, Habit>();

  return {
    async get(id: HabitId): Promise<Habit | null> {
      return store.get(id) ?? null;
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
        return staged.get(id)?.habit ?? store.get(id) ?? null;
      }

      const repository: HabitRepository = {
        async get(id: HabitId): Promise<Habit | null> {
          return view(id);
        },

        async save(habit: Habit, expectedVersion: number | null): Promise<void> {
          staged.set(habit.id, { habit, expectedVersion });
        },
      };

      return {
        repository,
        commit(): void {
          for (const [id, { expectedVersion }] of staged) {
            const existing = store.get(id);
            const currentVersion = existing ? existing.version : null;
            if (currentVersion !== expectedVersion) {
              throw new ConcurrencyConflict();
            }
          }
          for (const [id, { habit }] of staged) {
            store.set(id, habit);
          }
        },
      };
    },
  };
}
