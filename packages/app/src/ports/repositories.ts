import type { CircleRepository } from "../circle/circle.repository.ts";
import type { EntryRepository } from "../entry/entry.repository.ts";
import type { HabitRepository } from "../habit/habit.repository.ts";
import type { PauseRequestReader } from "../pause/pause-request.repository.ts";
import type { SeasonRepository } from "../season/season.repository.ts";

/**
 * The single transactional bag every use case's `UnitOfWork` operates over
 * (ADR-0008, D4/D6; see `unit-of-work.ts`'s docstring). Grows slice by
 * slice as new aggregates land.
 */
export interface Repositories {
  readonly circles: CircleRepository;
  readonly entries: EntryRepository;
  readonly habits: HabitRepository;
  /** Read-only until change A2 (app-pause-workflow). */
  readonly pauses: PauseRequestReader;
  readonly seasons: SeasonRepository;
}
