import type { CircleRepository } from "../circle/circle.repository.ts";
import type { SeasonGateReader } from "../circle/season-gate.port.ts";
import type { HabitRepository } from "../habit/habit.repository.ts";

/**
 * The single transactional bag every use case's `UnitOfWork` operates over
 * (ADR-0008, D4/D6; see `unit-of-work.ts`'s docstring). Grows slice by
 * slice as new aggregates land -- `habits` is S4's first addition.
 * `seasonGate` is a narrow read seam for the join gate (A2,
 * `circle/season-gate.port.ts`); a later S4 commit replaces it once the
 * real `Season` aggregate exists.
 */
export interface Repositories {
  readonly circles: CircleRepository;
  readonly habits: HabitRepository;
  readonly seasonGate: SeasonGateReader;
}
