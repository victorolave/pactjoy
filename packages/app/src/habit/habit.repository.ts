import type { HabitId } from "../shared/ids.ts";
import type { Habit } from "./habit.ts";

/**
 * Storage port for {@link Habit} (ADR-0008, D6). Tested through its
 * in-memory adapter (`testing/in-memory-habit-repository.ts`), same
 * convention as `circle/circle.repository.ts` -- the interface alone has
 * no runtime behavior of its own.
 */
export interface HabitRepository {
  get(id: HabitId): Promise<Habit | null>;
  /**
   * The habits that exist for `ids`, in no particular order. Unknown ids are
   * skipped and repeated ids yield each habit once; `[]` for no ids. One round
   * trip on a real store. Ids must be well-formed uuids: the Postgres adapter
   * raises on a malformed id, whereas the in-memory adapter just skips it
   * (returns `[]`), consistent with `get`.
   */
  getMany(ids: readonly HabitId[]): Promise<readonly Habit[]>;
  /** @throws {ConcurrencyConflict} if the stored version no longer matches `expectedVersion` (D5). */
  save(habit: Habit, expectedVersion: number | null): Promise<void>;
}
