import { describe, expect, it } from "vitest";
import { addCommitment } from "../commitment/add-commitment.ts";
import { editCommitment } from "../commitment/edit-commitment.ts";
import { removeCommitment } from "../commitment/remove-commitment.ts";
import { editSeasonParams } from "../season/edit-season-params.ts";
import { habitId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { givenOpenPactWithOneApproval, storedSeason } from "../testing/pact-fixtures.ts";
import { instant } from "../time/instant.ts";

// Noon UTC keeps the local calendar date "2025-09-28" stable in America/Santiago.
const NOW = instant(1_759_060_800_000);

const DONE_MEASURE = {
  unit: "done" as const,
  frequency: { kind: "timesPerWeek" as const, times: 3 },
};

describe("approval resets at every pre-close seam (PA-2, PA-5, PA-6, B2)", () => {
  it("B2: editSeasonParams resets every recorded approval and keeps the pact open", async () => {
    const app = createTestApp({ now: NOW });
    const { season, andrea } = await givenOpenPactWithOneApproval(app);
    expect(season.approvals).toHaveLength(1);

    const result = await editSeasonParams(app, andrea, {
      seasonId: season.id,
      startDate: "2025-10-06",
    });

    expect(result.ok).toBe(true);
    const stored = await storedSeason(app, season.id);
    expect(stored.approvals).toEqual([]);
    expect(stored.status).toBe("pactOpen");
    expect(stored.nominalStart).toBe("2025-10-06");
  });

  it("PA-2: addCommitment resets every recorded approval", async () => {
    const app = createTestApp({ now: NOW });
    const { season, victor } = await givenOpenPactWithOneApproval(app);

    const result = await addCommitment(app, victor, {
      seasonId: season.id,
      habitId: habitId("habit-read"),
      weightPercent: 10,
      privacy: "visible",
      measure: DONE_MEASURE,
    });

    expect(result.ok).toBe(true);
    const stored = await storedSeason(app, season.id);
    expect(stored.approvals).toEqual([]);
    expect(stored.commitments).toHaveLength(3);
  });

  it("PA-2: editCommitment resets every recorded approval", async () => {
    const app = createTestApp({ now: NOW });
    const { season, victor } = await givenOpenPactWithOneApproval(app);
    const victorsCommitment = season.commitments[1];
    if (!victorsCommitment) throw new Error("fixture setup failed");

    const result = await editCommitment(app, victor, {
      seasonId: season.id,
      commitmentId: victorsCommitment.id,
      weightPercent: 100,
      privacy: "private",
      measure: DONE_MEASURE,
    });

    expect(result.ok).toBe(true);
    expect((await storedSeason(app, season.id)).approvals).toEqual([]);
  });

  it("PA-2: removeCommitment resets every recorded approval", async () => {
    const app = createTestApp({ now: NOW });
    const { season, victor } = await givenOpenPactWithOneApproval(app);
    const victorsCommitment = season.commitments[1];
    if (!victorsCommitment) throw new Error("fixture setup failed");

    const result = await removeCommitment(app, victor, {
      seasonId: season.id,
      commitmentId: victorsCommitment.id,
    });

    expect(result.ok).toBe(true);
    const stored = await storedSeason(app, season.id);
    expect(stored.approvals).toEqual([]);
    expect(stored.commitments).toHaveLength(1);
  });
});
