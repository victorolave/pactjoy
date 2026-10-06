import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Actor } from "../shared/actor.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import type { HabitId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { type BuildHabitError, type Habit, validateHabitFields } from "./habit.ts";

export interface UpdateHabitDeps {
  readonly uow: UnitOfWork<Repositories>;
}

/** An absent field stays unchanged; `null` clears an optional one (`name` cannot be cleared). */
export interface UpdateHabitInput {
  readonly habitId: HabitId;
  readonly expectedVersion: number;
  readonly name?: string;
  readonly why?: string | null;
  readonly category?: string | null;
  readonly icon?: string | null;
}

export type UpdateHabitError = BuildHabitError | { readonly kind: "HabitNotFound" };

/**
 * Edits the caller's own habit (HB-R3). Someone else's habit is `HabitNotFound`,
 * the same as an unknown id, so existence never leaks. A stale `expectedVersion`
 * raises {@link ConcurrencyConflict}. Commitments and approvals are untouched
 * (HB-R4: a habit is not a commitment).
 */
export async function updateHabit(
  deps: UpdateHabitDeps,
  actor: Actor,
  input: UpdateHabitInput,
): Promise<Result<Habit, UpdateHabitError>> {
  return deps.uow.transaction(async (repos): Promise<Result<Habit, UpdateHabitError>> => {
    const habit = await repos.habits.get(input.habitId);
    if (!habit || habit.ownerId !== actor.userId) {
      return err({ kind: "HabitNotFound" });
    }
    if (habit.version !== input.expectedVersion) {
      throw new ConcurrencyConflict();
    }

    const fields = validateHabitFields({
      name: input.name ?? habit.name,
      why: input.why === undefined ? habit.why : input.why,
      category: input.category === undefined ? habit.category : input.category,
      icon: input.icon === undefined ? habit.icon : input.icon,
    });
    if (!fields.ok) {
      return fields;
    }

    const updated: Habit = { ...habit, ...fields.value, version: habit.version + 1 };
    await repos.habits.save(updated, habit.version);
    return ok(updated);
  });
}
