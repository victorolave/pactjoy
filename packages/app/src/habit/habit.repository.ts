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
  /** @throws {ConcurrencyConflict} if the stored version no longer matches `expectedVersion` (D5). */
  save(habit: Habit, expectedVersion: number | null): Promise<void>;
}
