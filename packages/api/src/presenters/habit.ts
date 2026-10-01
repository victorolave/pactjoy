import type { Habit } from "@pactjoy/app";
import { presentInstant } from "./time.ts";

export interface HabitDto {
  readonly id: string;
  readonly name: string;
  readonly why: string | null;
  readonly category: string | null;
  readonly createdAt: string;
  readonly version: number;
}

/**
 * `ownerId` is omitted: a habit is only ever returned to its owner.
 * `why` is OWNER-ONLY (private motivation). Any future cross-member habit
 * view must use a separate presenter that drops `why`.
 */
export function presentHabit(habit: Habit): HabitDto {
  return {
    id: habit.id,
    name: habit.name,
    why: habit.why,
    category: habit.category,
    createdAt: presentInstant(habit.createdAt),
    version: habit.version,
  };
}
