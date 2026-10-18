import { createIntlTimeZone } from "../adapters/intl-time-zone.ts";
import type { IdGenerator } from "../ports/id-generator.ts";
import type { RandomSource } from "../ports/random-source.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Clock } from "../time/clock.port.ts";
import { type Instant, instant } from "../time/instant.ts";
import type { TimeZone } from "../time/time-zone.port.ts";
import { createFixedClock } from "./fixed-clock.ts";
import {
  createInMemoryCircleRepository,
  type InMemoryCircleRepository,
} from "./in-memory-circle-repository.ts";
import {
  createInMemoryEncouragementRepository,
  type InMemoryEncouragementRepository,
} from "./in-memory-encouragement-repository.ts";
import {
  createInMemoryEntryPhotoRepository,
  type InMemoryEntryPhotoRepository,
} from "./in-memory-entry-photo-repository.ts";
import {
  createInMemoryEntryRepository,
  type InMemoryEntryRepository,
} from "./in-memory-entry-repository.ts";
import {
  createInMemoryEvidenceStorage,
  type InMemoryEvidenceStorage,
} from "./in-memory-evidence-storage.ts";
import {
  createInMemoryFeedReactionRepository,
  type InMemoryFeedReactionRepository,
} from "./in-memory-feed-reaction-repository.ts";
import {
  createInMemoryHabitRepository,
  type InMemoryHabitRepository,
} from "./in-memory-habit-repository.ts";
import {
  createInMemoryNotificationOutbox,
  type InMemoryNotificationOutbox,
} from "./in-memory-notification-outbox.ts";
import {
  createInMemoryNudgeDismissalRepository,
  type InMemoryNudgeDismissalRepository,
} from "./in-memory-nudge-dismissal-repository.ts";
import {
  createInMemoryPauseRequestRepository,
  type InMemoryPauseRequestRepository,
} from "./in-memory-pause-request-repository.ts";
import {
  createInMemoryPushSubscriptionRepository,
  type InMemoryPushSubscriptionRepository,
} from "./in-memory-push-subscription-repository.ts";
import {
  createInMemoryReviewRepository,
  type InMemoryReviewRepository,
} from "./in-memory-review-repository.ts";
import {
  createInMemorySeasonClosureRepository,
  type InMemorySeasonClosureRepository,
} from "./in-memory-season-closure-repository.ts";
import {
  createInMemorySeasonRepository,
  type InMemorySeasonRepository,
} from "./in-memory-season-repository.ts";
import { createInMemoryUnitOfWork } from "./in-memory-unit-of-work.ts";
import { createSeededRandomSource } from "./seeded-random.ts";
import { createSequentialIdGenerator } from "./sequential-ids.ts";

/**
 * The ports every use-case test wires up, composed from deterministic
 * in-memory adapters. `uow` carries the concrete `Repositories` bag
 * (ADR-0008) -- `circles`/`habits`/`seasons` are the same concrete
 * instances backing `uow` (not copies), exposed directly so tests can set
 * up GIVEN state without going through a use case (e.g. saving a `Season`
 * fixture directly via `app.seasons.save` to control the join gate, B11).
 */
export interface TestApp {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly random: RandomSource;
  readonly timeZone: TimeZone;
  readonly uow: UnitOfWork<Repositories>;
  readonly circles: InMemoryCircleRepository;
  readonly encouragements: InMemoryEncouragementRepository;
  readonly entries: InMemoryEntryRepository;
  readonly entryPhotos: InMemoryEntryPhotoRepository;
  /** The fake object storage; `upload` plays the browser. Expiry follows the clock the app was created with. */
  readonly evidence: InMemoryEvidenceStorage;
  readonly feedReactions: InMemoryFeedReactionRepository;
  readonly habits: InMemoryHabitRepository;
  readonly notifications: InMemoryNotificationOutbox;
  readonly nudgeDismissals: InMemoryNudgeDismissalRepository;
  readonly pauses: InMemoryPauseRequestRepository;
  readonly pushSubscriptions: InMemoryPushSubscriptionRepository;
  readonly reviews: InMemoryReviewRepository;
  readonly seasonClosures: InMemorySeasonClosureRepository;
  readonly seasons: InMemorySeasonRepository;
}

export interface CreateTestAppOptions {
  readonly now?: Instant;
  readonly idPrefix?: string;
  readonly randomSeed?: number;
  /** Defaults to the real `IntlTimeZone` adapter (deterministic given a fixed IANA zone). */
  readonly timeZone?: TimeZone;
}

const DEFAULT_NOW: Instant = instant(1_700_000_000_000);
const DEFAULT_RANDOM_SEED = 42;

/** Builds a fully deterministic {@link TestApp} for use-case tests. */
export function createTestApp(options: CreateTestAppOptions = {}): TestApp {
  const circles = createInMemoryCircleRepository();
  const encouragements = createInMemoryEncouragementRepository();
  const entries = createInMemoryEntryRepository();
  const entryPhotos = createInMemoryEntryPhotoRepository();
  const feedReactions = createInMemoryFeedReactionRepository();
  const habits = createInMemoryHabitRepository();
  const notifications = createInMemoryNotificationOutbox();
  const nudgeDismissals = createInMemoryNudgeDismissalRepository();
  const pauses = createInMemoryPauseRequestRepository();
  const pushSubscriptions = createInMemoryPushSubscriptionRepository();
  const reviews = createInMemoryReviewRepository();
  const seasonClosures = createInMemorySeasonClosureRepository();
  const seasons = createInMemorySeasonRepository();
  const repositories: Repositories = {
    circles,
    encouragements,
    entries,
    entryPhotos,
    feedReactions,
    habits,
    notifications,
    nudgeDismissals,
    pauses,
    pushSubscriptions,
    reviews,
    seasonClosures,
    seasons,
  };

  const clock = createFixedClock(options.now ?? DEFAULT_NOW);
  return {
    clock,
    evidence: createInMemoryEvidenceStorage({ clock }),
    ids: createSequentialIdGenerator(options.idPrefix),
    random: createSeededRandomSource(options.randomSeed ?? DEFAULT_RANDOM_SEED),
    timeZone: options.timeZone ?? createIntlTimeZone(),
    circles,
    encouragements,
    entries,
    entryPhotos,
    feedReactions,
    habits,
    notifications,
    nudgeDismissals,
    pauses,
    pushSubscriptions,
    reviews,
    seasonClosures,
    seasons,
    uow: createInMemoryUnitOfWork({
      repositories,
      // Atomic across repositories (D5): validate EVERY scope's staged
      // writes first -- if any throws ConcurrencyConflict, nothing has
      // been mutated yet, so this whole transaction leaves no trace. Only
      // once every scope has validated cleanly do we apply any of them.
      // Splitting each scope's own commit into validate()/apply() is what
      // makes this possible without a partial commit across repositories.
      beginTransaction: () => {
        const circleScope = circles.beginTransaction();
        const encouragementScope = encouragements.beginTransaction();
        const entryScope = entries.beginTransaction();
        const entryPhotoScope = entryPhotos.beginTransaction();
        const feedReactionScope = feedReactions.beginTransaction();
        const habitScope = habits.beginTransaction();
        const notificationScope = notifications.beginTransaction();
        const nudgeDismissalScope = nudgeDismissals.beginTransaction();
        const pauseScope = pauses.beginTransaction();
        const pushSubscriptionScope = pushSubscriptions.beginTransaction();
        const reviewScope = reviews.beginTransaction();
        const seasonClosureScope = seasonClosures.beginTransaction();
        const seasonScope = seasons.beginTransaction();
        return {
          repositories: {
            circles: circleScope.repository,
            encouragements: encouragementScope.repository,
            entries: entryScope.repository,
            entryPhotos: entryPhotoScope.repository,
            feedReactions: feedReactionScope.repository,
            habits: habitScope.repository,
            notifications: notificationScope.repository,
            nudgeDismissals: nudgeDismissalScope.repository,
            pauses: pauseScope.repository,
            pushSubscriptions: pushSubscriptionScope.repository,
            reviews: reviewScope.repository,
            seasonClosures: seasonClosureScope.repository,
            seasons: seasonScope.repository,
          },
          commit(): void {
            circleScope.validate();
            encouragementScope.validate();
            entryScope.validate();
            entryPhotoScope.validate();
            feedReactionScope.validate();
            habitScope.validate();
            notificationScope.validate();
            nudgeDismissalScope.validate();
            pauseScope.validate();
            pushSubscriptionScope.validate();
            reviewScope.validate();
            seasonClosureScope.validate();
            seasonScope.validate();
            circleScope.apply();
            encouragementScope.apply();
            entryScope.apply();
            entryPhotoScope.apply();
            feedReactionScope.apply();
            habitScope.apply();
            notificationScope.apply();
            nudgeDismissalScope.apply();
            pauseScope.apply();
            pushSubscriptionScope.apply();
            reviewScope.apply();
            seasonClosureScope.apply();
            seasonScope.apply();
          },
        };
      },
    }),
  };
}
