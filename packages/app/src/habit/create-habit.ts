import type { IdGenerator } from "../ports/id-generator.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Actor } from "../shared/actor.ts";
import { habitId } from "../shared/ids.ts";
import type { Result } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import { type BuildHabitError, buildHabit, type Habit } from "./habit.ts";

export interface CreateHabitDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

export interface CreateHabitInput {
  readonly name: string;
  readonly why?: string | null;
  readonly category?: string | null;
  readonly icon?: string | null;
}

export type CreateHabitError = BuildHabitError;

/**
 * Creates a habit owned by `actor` (SS-1, SS-2). Habits are not capped per
 * user -- unlike circle membership (A5), a person may track any number of
 * habits across their circles/seasons.
 */
export async function createHabit(
  deps: CreateHabitDeps,
  actor: Actor,
  input: CreateHabitInput,
): Promise<Result<Habit, CreateHabitError>> {
  return deps.uow.transaction(async (repos): Promise<Result<Habit, CreateHabitError>> => {
    const built = buildHabit({
      id: habitId(deps.ids.next()),
      ownerId: actor.userId,
      name: input.name,
      why: input.why ?? null,
      category: input.category ?? null,
      icon: input.icon ?? null,
      now: deps.clock.now(),
    });
    if (!built.ok) {
      return built;
    }

    await repos.habits.save(built.value, null);
    return built;
  });
}
