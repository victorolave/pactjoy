import { describe, expect, it } from "vitest";
import { addCommitment } from "../commitment/add-commitment.ts";
import { editCommitment } from "../commitment/edit-commitment.ts";
import { removeCommitment } from "../commitment/remove-commitment.ts";
import { approvePact } from "../pact/approve-pact.ts";
import { withdrawApproval } from "../pact/withdraw-approval.ts";
import { editSeasonParams } from "../season/edit-season-params.ts";
import { habitId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { givenSoloOpenPact } from "../testing/pact-fixtures.ts";
import { instant } from "../time/instant.ts";
import { leaveCircle } from "./leave-circle.ts";

// Noon UTC keeps the local calendar date stable in America/Santiago.
const NOW = instant(1_759_060_800_000);

describe("an archived circle's kept ACTIVE season is frozen", () => {
  it("every season and commitment use case rejects the leaver with NotAMember and changes nothing", async () => {
    const app = createTestApp({ now: NOW });
    const { circle, season, andrea } = await givenSoloOpenPact(app);
    const closed = await approvePact(app, andrea, { seasonId: season.id });
    if (!closed.ok) throw new Error("fixture setup failed");
    const left = await leaveCircle(app, andrea, { circleId: circle.id });
    if (!left.ok) throw new Error("fixture setup failed");
    const commitmentId = season.commitments[0]?.id;
    if (!commitmentId) throw new Error("fixture setup failed");
    const seasonId = season.id;

    const attempts = {
      approvePact: () => approvePact(app, andrea, { seasonId }),
      withdrawApproval: () => withdrawApproval(app, andrea, { seasonId }),
      addCommitment: () =>
        addCommitment(app, andrea, {
          seasonId,
          habitId: habitId("habit-other"),
          weightPercent: 100,
          privacy: "visible",
          measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } },
        }),
      editCommitment: () =>
        editCommitment(app, andrea, {
          seasonId,
          commitmentId,
          weightPercent: 100,
          privacy: "private",
          measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } },
        }),
      removeCommitment: () => removeCommitment(app, andrea, { seasonId, commitmentId }),
      editSeasonParams: () => editSeasonParams(app, andrea, { seasonId, lengthWeeks: 12 }),
    };

    for (const [name, attempt] of Object.entries(attempts)) {
      const result = await attempt();
      expect(result, name).toEqual({ ok: false, error: { kind: "NotAMember" } });
    }
    expect(await app.seasons.get(seasonId)).toEqual(closed.value);
    expect(await app.circles.get(circle.id)).toEqual(left.value);
  });
});
