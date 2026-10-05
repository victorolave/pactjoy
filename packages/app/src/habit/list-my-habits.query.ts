import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Actor } from "../shared/actor.ts";
import type { Habit } from "./habit.ts";

export interface ListMyHabitsDeps {
  readonly uow: UnitOfWork<Repositories>;
}

/** The caller's own habits, newest first (HB-R2). Total: no habits is `[]`. */
export async function listMyHabits(
  deps: ListMyHabitsDeps,
  actor: Actor,
): Promise<readonly Habit[]> {
  return deps.uow.read((repos) => repos.habits.listByOwner(actor.userId));
}
