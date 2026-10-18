import { createTestApp } from "../testing/app-harness.ts";
import { createFixedClock } from "../testing/fixed-clock.ts";
import { createInMemoryEncouragementRepository } from "../testing/in-memory-encouragement-repository.ts";
import { createInMemoryEntryPhotoRepository } from "../testing/in-memory-entry-photo-repository.ts";
import { createInMemoryEvidenceStorage } from "../testing/in-memory-evidence-storage.ts";
import { createInMemoryFeedReactionRepository } from "../testing/in-memory-feed-reaction-repository.ts";
import { createInMemoryNudgeDismissalRepository } from "../testing/in-memory-nudge-dismissal-repository.ts";
import { createInMemoryReviewRepository } from "../testing/in-memory-review-repository.ts";
import { createInMemorySeasonClosureRepository } from "../testing/in-memory-season-closure-repository.ts";
import { instant } from "../time/instant.ts";
import { describeCircleRepositoryContract } from "./circle.contract.ts";
import { describeCommitmentReminderContract } from "./commitment-reminder.contract.ts";
import {
  describeEncouragementRepositoryContract,
  describeNudgeDismissalRepositoryContract,
} from "./encouragement.contract.ts";
import { describeEntryRepositoryContract } from "./entry.contract.ts";
import { describeEntryPhotoRepositoryContract } from "./entry-photo.contract.ts";
import { describeEvidenceStorageContract } from "./evidence-storage.contract.ts";
import { describeFeedReactionRepositoryContract } from "./feed-reaction.contract.ts";
import {
  describeCircleGuardContract,
  describeSeasonGuardContract,
} from "./guard-version.contract.ts";
import { describeHabitRepositoryContract } from "./habit.contract.ts";
import { describeNotificationOutboxContract } from "./notification-outbox.contract.ts";
import { describePauseRequestRepositoryContract } from "./pause.contract.ts";
import { describePushSubscriptionContract } from "./push-subscription.contract.ts";
import { describeReviewRepositoryContract } from "./review.contract.ts";
import { describeSeasonRepositoryContract } from "./season.contract.ts";
import { describeSeasonClosureRepositoryContract } from "./season-closure.contract.ts";
import { describeUnitOfWorkContract } from "./unit-of-work.contract.ts";

const inMemory = async () => ({ uow: createTestApp().uow });

describeCircleRepositoryContract("in-memory", inMemory);
describeCircleGuardContract("in-memory", inMemory);
describeSeasonGuardContract("in-memory", inMemory);
describeEntryRepositoryContract("in-memory", inMemory);
describeHabitRepositoryContract("in-memory", inMemory);
describeEntryPhotoRepositoryContract("in-memory", async () => ({
  repository: createInMemoryEntryPhotoRepository(),
}));
describeSeasonRepositoryContract("in-memory", inMemory);
describePauseRequestRepositoryContract("in-memory", inMemory);
describeNotificationOutboxContract("in-memory", inMemory);
describePushSubscriptionContract("in-memory", inMemory);
describeCommitmentReminderContract("in-memory", inMemory);
describeReviewRepositoryContract("in-memory", async () => ({
  repository: createInMemoryReviewRepository(),
}));
describeFeedReactionRepositoryContract("in-memory", async () => ({
  repository: createInMemoryFeedReactionRepository(),
}));
describeEncouragementRepositoryContract("in-memory", async () => ({
  repository: createInMemoryEncouragementRepository(),
}));
describeNudgeDismissalRepositoryContract("in-memory", async () => ({
  repository: createInMemoryNudgeDismissalRepository(),
}));
describeSeasonClosureRepositoryContract("in-memory", async () => ({
  repository: createInMemorySeasonClosureRepository(),
}));
describeUnitOfWorkContract("in-memory", inMemory);

describeEvidenceStorageContract("in-memory", async () => {
  const now = instant(1_791_987_120_000);
  const storage = createInMemoryEvidenceStorage({ clock: createFixedClock(now) });
  return {
    storage,
    now: () => now,
    upload: async (request, bytes, headers) => storage.upload(request, bytes, headers),
    download: async (request) => storage.download(request),
  };
});
