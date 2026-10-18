import type { Repositories } from "@pactjoy/app";
import { createPgCircleRepository } from "./circle/pg-circle-repository.ts";
import type { BindMode, SqlExecutor } from "./client.ts";
import { createPgEncouragementRepository } from "./encouragement/pg-encouragement-repository.ts";
import { createPgNudgeDismissalRepository } from "./encouragement/pg-nudge-dismissal-repository.ts";
import { createPgEntryRepository } from "./entry/pg-entry-repository.ts";
import { createPgEntryPhotoRepository } from "./entry-photo/pg-entry-photo-repository.ts";
import { createPgHabitRepository } from "./habit/pg-habit-repository.ts";
import { createPgNotificationOutboxRepository } from "./notifications/pg-notification-outbox-repository.ts";
import { createPgPushSubscriptionRepository } from "./notifications/pg-push-subscription-repository.ts";
import { createPgPauseRequestRepository } from "./pause/pg-pause-request-repository.ts";
import { createPgFeedReactionRepository } from "./reaction/pg-feed-reaction-repository.ts";
import { createPgCommitmentReminderRepository } from "./reminders/pg-commitment-reminder-repository.ts";
import { createPgReviewRepository } from "./review/pg-review-repository.ts";
import { createPgSeasonClosureRepository } from "./season/pg-season-closure-repository.ts";
import { createPgSeasonRepository } from "./season/pg-season-repository.ts";

/** Every repository the application's `UnitOfWork` hands to a use case. */
export type PgRepositories = Repositories;

/**
 * Fresh repositories closed over ONE transaction's executor. Nothing is shared
 * between transactions, so a repository can never run outside its transaction.
 */
export function bindRepositories(exec: SqlExecutor, mode: BindMode): PgRepositories {
  return {
    habits: createPgHabitRepository(exec),
    circles: createPgCircleRepository(exec, mode),
    seasons: createPgSeasonRepository(exec, mode),
    entries: createPgEntryRepository(exec),
    entryPhotos: createPgEntryPhotoRepository(exec),
    notifications: createPgNotificationOutboxRepository(exec),
    pauses: createPgPauseRequestRepository(exec),
    pushSubscriptions: createPgPushSubscriptionRepository(exec),
    reminders: createPgCommitmentReminderRepository(exec),
    reviews: createPgReviewRepository(exec),
    seasonClosures: createPgSeasonClosureRepository(exec),
    feedReactions: createPgFeedReactionRepository(exec),
    encouragements: createPgEncouragementRepository(exec),
    nudgeDismissals: createPgNudgeDismissalRepository(exec),
  };
}
