import { describe, expect, it } from "vitest";

/**
 * Pins the app's public runtime API surface, same convention as
 * `packages/engine/src/index.test.ts`: type-only exports are erased at
 * runtime and can't appear here.
 */
const EXPECTED_RUNTIME_EXPORTS = [
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
  "withdrawApproval",
].sort();

describe("@pactjoy/app public API", () => {
  it("exposes exactly the expected runtime exports", async () => {
    const app = await import("./index.ts");
    expect(Object.keys(app).sort()).toEqual(EXPECTED_RUNTIME_EXPORTS);
  });
});
