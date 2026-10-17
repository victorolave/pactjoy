import type { CircleRepository } from "../circle/circle.repository.ts";
import type { EntryRepository } from "../entry/entry.repository.ts";
import type { EntryPhotoRepository } from "../entry-photo/entry-photo.repository.ts";
import type { HabitRepository } from "../habit/habit.repository.ts";
import type { PauseRequestRepository } from "../pause/pause-request.repository.ts";
import type { FeedReactionRepository } from "../reaction/feed-reaction.repository.ts";
import type { ReviewRepository } from "../review/review.repository.ts";
import type { SeasonClosureRepository } from "../season/closure/season-closure.repository.ts";
import type { SeasonRepository } from "../season/season.repository.ts";

/**
 * The single transactional bag every use case's `UnitOfWork` operates over
 * (ADR-0008, D4/D6; see `unit-of-work.ts`'s docstring). Grows slice by
 * slice as new aggregates land.
 */
export interface Repositories {
  readonly circles: CircleRepository;
  readonly entries: EntryRepository;
  /** Confined to `src/entry-photo/` (`entry-photo-guard.test.ts`): a row carries the object key, which never reaches a peer. */
  readonly entryPhotos: EntryPhotoRepository;
  /** Reactions to feed items (ADR-0018). Counts are public, so no guard confines it; the sentinels cover what leaves. */
  readonly feedReactions: FeedReactionRepository;
  readonly habits: HabitRepository;
  /** Read it through `loadEffectivePauses`, never directly (ADR-0013). */
  readonly pauses: PauseRequestRepository;
  /** Owner-only: read it only from `src/review/` (`review-guard.test.ts`), never for a peer. */
  readonly reviews: ReviewRepository;
  /** Decisions are owner-only: use it only from `src/season/closure/` (`closure-guard.test.ts`). */
  readonly seasonClosures: SeasonClosureRepository;
  readonly seasons: SeasonRepository;
}
