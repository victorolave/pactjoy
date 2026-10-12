import { describe, expect, it } from "vitest";

/**
 * Pins the app's public runtime API surface, same convention as
 * `packages/engine/src/index.test.ts`: type-only exports are erased at
 * runtime and can't appear here.
 */
const EXPECTED_RUNTIME_EXPORTS = [
  "AUTO_APPROVE_AFTER_MS",
  "PAUSE_REASONS",
  "addCommitment",
  "approvePact",
  "buildCommitment",
  "canSeeDetail",
  "circleId",
  "commitmentId",
  "commitmentToEngine",
  "ConcurrencyConflict",
  "createCircle",
  "createHabit",
  "createIntlTimeZone",
  "createSeason",
  "createSystemClock",
  "createCryptoRandomSource",
  "createUuidV7IdGenerator",
  "deleteEntry",
  "editCommitment",
  "editEntry",
  "editSeasonParams",
  "entryId",
  "err",
  "generateInvite",
  "habitId",
  "pauseRequestId",
  "instant",
  "isInviteCodeFormat",
  "inviteCode",
  "InviteCodeGenerationFailed",
  "joinCircle",
  "leaveCircle",
  "listMyHabits",
  "localDate",
  "isReviewCadenceWeeks",
  "isSeasonLengthWeeks",
  "localDateOfSeasonDay",
  "memberId",
  "memberProgress",
  "commitmentProgress",
  "myCircle",
  "previewInvite",
  "previewProgress",
  "memberScore",
  "ok",
  "recordEntry",
  "removeCommitment",
  "renameCircle",
  "renameMyDisplayName",
  "reviewCadenceForLength",
  "seasonId",
  "seasonProgress",
  "seasonView",
  "standings",
  "timeZoneId",
  "toDecimalString",
  "today",
  "toSeasonDay",
  "updateHabit",
  "userId",
  "validateCommitment",
  "visibleNote",
  "weekSummary",
  "withdrawApproval",
].sort();

describe("@pactjoy/app public API", () => {
  it("exposes exactly the expected runtime exports", async () => {
    const app = await import("./index.ts");
    expect(Object.keys(app).sort()).toEqual(EXPECTED_RUNTIME_EXPORTS);
  });
});
