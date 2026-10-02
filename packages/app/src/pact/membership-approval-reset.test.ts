import { describe, expect, it } from "vitest";
import { createCircle } from "../circle/create-circle.ts";
import { generateInvite } from "../circle/generate-invite.ts";
import { joinCircle } from "../circle/join-circle.ts";
import { leaveCircle } from "../circle/leave-circle.ts";
import { habitId, userId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { createCircleInput, joinCircleInput } from "../testing/circle-inputs.ts";
import {
  givenOpenPactWithOneApproval,
  givenSoloOpenPact,
  storedSeason,
} from "../testing/pact-fixtures.ts";
import { instant } from "../time/instant.ts";
import { approvePact } from "./approve-pact.ts";

// Noon UTC keeps the local calendar date "2025-09-28" stable in America/Santiago.
const NOW = instant(1_759_060_800_000);

describe("approval resets when membership changes (PA-5, PA-6)", () => {
  it("PA-5: a new member joining while the pact is open resets every recorded approval", async () => {
    const app = createTestApp({ now: NOW });
    const { circle, season, andrea } = await givenOpenPactWithOneApproval(app);
    const invite = await generateInvite(app, andrea, { circleId: circle.id });
    if (!invite.ok) throw new Error("fixture setup failed");

    const joined = await joinCircle(
      app,
      { userId: userId("user-carla") },
      joinCircleInput(invite.value.code),
    );

    expect(joined.ok).toBe(true);
    const stored = await storedSeason(app, season.id);
    expect(stored.approvals).toEqual([]);
    expect(stored.status).toBe("pactOpen");
    expect(stored.pactRevision).toBe(season.pactRevision + 1);
  });

  it("PA-6: a non-approving member leaving discards their commitments and resets every approval", async () => {
    const app = createTestApp({ now: NOW });
    const { circle, season, victor } = await givenOpenPactWithOneApproval(app);

    const left = await leaveCircle(app, victor, { circleId: circle.id });

    expect(left.ok).toBe(true);
    const stored = await storedSeason(app, season.id);
    expect(stored.approvals).toEqual([]);
    expect(stored.commitments).toHaveLength(1);
    expect(stored.pactRevision).toBe(season.pactRevision + 1);
    expect(stored.commitments.every((c) => c.habitId === habitId("habit-user-andrea"))).toBe(true);
  });

  it("PA-6: an approving member leaving also resets the remaining approvals and discards theirs", async () => {
    const app = createTestApp({ now: NOW });
    const { circle, season, andrea } = await givenOpenPactWithOneApproval(app);

    const left = await leaveCircle(app, andrea, { circleId: circle.id });

    expect(left.ok).toBe(true);
    const stored = await storedSeason(app, season.id);
    expect(stored.approvals).toEqual([]);
    expect(stored.commitments.every((c) => c.habitId === habitId("habit-user-victor"))).toBe(true);
  });

  it("PA-6: leaving a circle whose season is already active neither discards commitments nor touches approvals", async () => {
    const app = createTestApp({ now: NOW });
    const { circle, season, victor } = await givenOpenPactWithOneApproval(app);
    const closed = await approvePact(app, victor, {
      seasonId: season.id,
      expectedPactRevision: season.pactRevision,
    });
    if (!closed.ok) throw new Error("fixture setup failed");
    expect(closed.value.status).toBe("active");

    const left = await leaveCircle(app, victor, { circleId: circle.id });

    expect(left.ok).toBe(true);
    const stored = await storedSeason(app, season.id);
    expect(stored.status).toBe("active");
    expect(stored.pactRevision).toBe(season.pactRevision);
    expect(stored.approvals).toHaveLength(2);
    expect(stored.commitments).toHaveLength(2);
  });

  it("leaving a circle that has no season at all still works (nothing to discard or reset)", async () => {
    const app = createTestApp({ now: NOW });
    const andrea = { userId: userId("user-andrea") };
    const circle = await createCircle(app, andrea, createCircleInput("Río Runners"));
    if (!circle.ok) throw new Error("fixture setup failed");

    const left = await leaveCircle(app, andrea, { circleId: circle.value.id });

    expect(left.ok).toBe(true);
  });

  it("the last member leaving while the pact is open discards the season; the archived circle rejects a later joiner", async () => {
    const app = createTestApp({ now: NOW });
    const { circle, season, andrea } = await givenSoloOpenPact(app);
    const invite = await generateInvite(app, andrea, { circleId: circle.id });
    if (!invite.ok) throw new Error("fixture setup failed");

    const left = await leaveCircle(app, andrea, { circleId: circle.id });

    expect(left.ok).toBe(true);
    expect(await app.uow.read((repos) => repos.seasons.get(season.id))).toBeNull();

    const joined = await joinCircle(
      app,
      { userId: userId("user-carla") },
      joinCircleInput(invite.value.code),
    );
    expect(joined).toEqual({ ok: false, error: { kind: "CircleArchived" } });
  });

  it("the last member leaving after the pact closed keeps the season", async () => {
    const app = createTestApp({ now: NOW });
    const { circle, season, andrea } = await givenSoloOpenPact(app);
    const closed = await approvePact(app, andrea, {
      seasonId: season.id,
      expectedPactRevision: season.pactRevision,
    });
    if (!closed.ok) throw new Error("fixture setup failed");
    expect(closed.value.status).toBe("active");

    const left = await leaveCircle(app, andrea, { circleId: circle.id });

    expect(left.ok).toBe(true);
    expect((await storedSeason(app, season.id)).status).toBe("active");
  });
});
