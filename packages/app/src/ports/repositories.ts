import type { CircleRepository } from "../circle/circle.repository.ts";
import type { EntryRepository } from "../entry/entry.repository.ts";
import type { HabitRepository } from "../habit/habit.repository.ts";
import type { PauseRequestRepository } from "../pause/pause-request.repository.ts";
import type { ReviewRepository } from "../review/review.repository.ts";
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
  /** Read it through `loadEffectivePauses`, never directly (ADR-0013). */
  readonly pauses: PauseRequestRepository;
  /** Owner-only: read it only from `src/review/` (`review-guard.test.ts`), never for a peer. */
  readonly reviews: ReviewRepository;
  readonly seasons: SeasonRepository;
}
