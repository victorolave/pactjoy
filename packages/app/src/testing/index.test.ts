import { describe, expect, it } from "vitest";

/** Pins the `./testing` subpath's runtime API surface, same convention as `../index.test.ts`. */
const EXPECTED_RUNTIME_EXPORTS = [
  "circleFixture",
  "entryPhotoFixture",
  "createCircleInput",
  "createFixedClock",
  "createFixedOffsetTimeZone",
  "createInMemoryCircleRepository",
  "createInMemoryEntryPhotoRepository",
  "createInMemoryEntryRepository",
  "createInMemoryEvidenceStorage",
  "createInMemoryHabitRepository",
  "createInMemoryNotificationOutbox",
  "createInMemoryPauseRequestRepository",
  "createInMemoryPushSubscriptionRepository",
  "createInMemoryCommitmentReminderRepository",
  "createInMemoryReviewRepository",
  "createInMemorySeasonClosureRepository",
  "createInMemorySeasonRepository",
  "createInMemoryUnitOfWork",
  "createRecordingPushSender",
  "createSeededRandomSource",
  "createSequentialIdGenerator",
  "createTestApp",
  "habitFixture",
  "joinCircleInput",
  "memberFixture",
  "outboxNoticeFixture",
  "pauseRequestFixture",
  "pushSubscriptionFixture",
  "reviewFixture",
  "seasonClosureFixture",
  "seasonFixture",
].sort();

describe("@pactjoy/app testing subpath", () => {
  // A cold import of the whole subpath: under a full `turbo run test` it can exceed the 5 s default.
  it("exposes exactly the expected runtime exports", { timeout: 30_000 }, async () => {
    const testing = await import("./index.ts");
    expect(Object.keys(testing).sort()).toEqual(EXPECTED_RUNTIME_EXPORTS);
  });
});
