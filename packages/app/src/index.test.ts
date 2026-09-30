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
  "circleId",
  "commitmentId",
  "commitmentToEngine",
  "ConcurrencyConflict",
  "createCircle",
  "createHabit",
  "createIntlTimeZone",
  "createSeason",
  "createSystemClock",
  "editCommitment",
  "editSeasonParams",
  "entryId",
  "err",
  "generateInvite",
  "habitId",
  "instant",
  "InviteCodeGenerationFailed",
  "joinCircle",
  "leaveCircle",
  "localDate",
  "localDateOfSeasonDay",
  "ok",
  "removeCommitment",
  "renameCircle",
  "reviewCadenceForLength",
  "seasonId",
  "timeZoneId",
  "toSeasonDay",
  "userId",
  "validateCommitment",
  "withdrawApproval",
].sort();

describe("@pactjoy/app public API", () => {
  it("exposes exactly the expected runtime exports", async () => {
    const app = await import("./index.ts");
    expect(Object.keys(app).sort()).toEqual(EXPECTED_RUNTIME_EXPORTS);
  });
});
