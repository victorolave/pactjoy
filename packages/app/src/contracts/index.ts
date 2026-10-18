/**
 * Adapter-neutral contract suites (`exports: "./contracts"` in `package.json`).
 * They import vitest, so this subpath is a test-only surface: it is never
 * imported from `src/index.ts` or `src/testing/**`, which the api runtime
 * loads (see `no-vitest-in-testing.test.ts`). An adapter package runs each
 * suite with a factory returning a fresh `{ uow }` over an empty store.
 */

export { describeCircleRepositoryContract } from "./circle.contract.ts";
export { describeCommitmentReminderContract } from "./commitment-reminder.contract.ts";
export { describeEntryRepositoryContract } from "./entry.contract.ts";
export type { EntryPhotoContractSubject } from "./entry-photo.contract.ts";
export { describeEntryPhotoRepositoryContract } from "./entry-photo.contract.ts";
export type { EvidenceStorageContractSubject } from "./evidence-storage.contract.ts";
export { describeEvidenceStorageContract } from "./evidence-storage.contract.ts";
export type { ContractSubject } from "./fixtures.ts";
export {
  describeCircleGuardContract,
  describeSeasonGuardContract,
} from "./guard-version.contract.ts";
export { describeHabitRepositoryContract } from "./habit.contract.ts";
export { describeNotificationOutboxContract } from "./notification-outbox.contract.ts";
export { describePauseRequestRepositoryContract } from "./pause.contract.ts";
export { describePushSubscriptionContract } from "./push-subscription.contract.ts";
export type { ReviewContractSubject } from "./review.contract.ts";
export { describeReviewRepositoryContract } from "./review.contract.ts";
export { describeSeasonRepositoryContract } from "./season.contract.ts";
export type { SeasonClosureContractSubject } from "./season-closure.contract.ts";
export { describeSeasonClosureRepositoryContract } from "./season-closure.contract.ts";
export { describeUnitOfWorkContract } from "./unit-of-work.contract.ts";
