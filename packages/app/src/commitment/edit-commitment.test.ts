import { describe, expect, it, vi } from "vitest";
import { createCircle } from "../circle/create-circle.ts";
import { generateInvite } from "../circle/generate-invite.ts";
import { joinCircle } from "../circle/join-circle.ts";
import { createSeason } from "../season/create-season.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { habitId, userId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { createCircleInput } from "../testing/circle-inputs.ts";
import { givenOpenPactWithOneApproval, storedSeason } from "../testing/pact-fixtures.ts";
import { instant } from "../time/instant.ts";
import { addCommitment } from "./add-commitment.ts";
import { commitmentId } from "./commitment.ts";
import { editCommitment } from "./edit-commitment.ts";

function actorFor(id: string) {
  return { userId: userId(id) };
}

const NOW = instant(1_759_060_800_000); // 2025-09-28T12:00:00.000Z

async function seasonWithCommitment(app: ReturnType<typeof createTestApp>) {
  const circle = await createCircle(app, actorFor("user-andrea"), createCircleInput("Río Runners"));
  if (!circle.ok) throw new Error("fixture setup failed");
  const season = await createSeason(app, actorFor("user-andrea"), {
    circleId: circle.value.id,
    timezone: "America/Santiago",
    startDate: "2025-10-01",
    lengthWeeks: 8,
  });
  if (!season.ok) throw new Error("fixture setup failed");
  const added = await addCommitment(app, actorFor("user-andrea"), {
    seasonId: season.value.id,
    habitId: habitId("habit-run"),
    weightPercent: 20,
    privacy: "visible",
    measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } },
  });
  if (!added.ok) throw new Error("fixture setup failed");
  return { circle: circle.value, season: added.value, commitment: added.value.commitments[0] };
}

describe("editCommitment no-op (SS-13, PI-S12..S14)", () => {
  const DONE_3 = { unit: "done" as const, frequency: { kind: "timesPerWeek" as const, times: 3 } };
  const MINUTES = (minimum: string, ideal: string) => ({
    unit: "minutes" as const,
    direction: "reach" as const,
    minimum,
    ideal,
    schedule: { period: "weeklyTotal" as const },
  });

  it("PI-S12: an identical edit returns the unchanged season: no save, approvals, version and pactRevision intact", async () => {
    const app = createTestApp({ now: NOW });
    const { season, andrea } = await givenOpenPactWithOneApproval(app);
    const mine = season.commitments[0];
    if (!mine) throw new Error("fixture setup failed");
    const save = vi.spyOn(app.seasons, "save");

    const result = await editCommitment(app, andrea, {
      seasonId: season.id,
      commitmentId: mine.id,
      weightPercent: mine.weightPercent,
      privacy: mine.privacy,
      measure: DONE_3,
    });

    expect(result).toEqual({ ok: true, value: season });
    expect(save).not.toHaveBeenCalled();
    const stored = await storedSeason(app, season.id);
    expect(stored.approvals).toHaveLength(1);
    expect(stored.version).toBe(season.version);
    expect(stored.pactRevision).toBe(season.pactRevision);
  });

  it("PI-S13: a measure equal in value but written differently is a no-op; a different threshold resets and bumps", async () => {
    const app = createTestApp({ now: NOW });
    const { season, andrea } = await givenOpenPactWithOneApproval(app);
    const mine = season.commitments[0];
    if (!mine) throw new Error("fixture setup failed");
    const base = { seasonId: season.id, commitmentId: mine.id, weightPercent: 100 } as const;
    const first = await editCommitment(app, andrea, {
      ...base,
      privacy: "visible",
      measure: MINUTES("10", "30"),
    });
    if (!first.ok) throw new Error("fixture setup failed");
    const repeated = await editCommitment(app, andrea, {
      ...base,
      privacy: "visible",
      measure: MINUTES("10.0", "30.00"),
    });
    expect(repeated).toEqual({ ok: true, value: first.value });
    expect((await storedSeason(app, season.id)).version).toBe(first.value.version);

    const changed = await editCommitment(app, andrea, {
      ...base,
      privacy: "visible",
      measure: MINUTES("10", "31"),
    });

    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.value.version).toBe(first.value.version + 1);
    expect(changed.value.pactRevision).toBe(first.value.pactRevision + 1);
  });

  it.each([
    { field: "weight", change: { weightPercent: 50, privacy: "visible" } },
    { field: "privacy", change: { weightPercent: 100, privacy: "private" } },
  ] as const)(
    "a change in $field alone is still effective: resets approvals and bumps",
    async ({ change }) => {
      const app = createTestApp({ now: NOW });
      const { season, andrea } = await givenOpenPactWithOneApproval(app);
      const mine = season.commitments[0];
      if (!mine) throw new Error("fixture setup failed");
      expect({ weightPercent: mine.weightPercent, privacy: mine.privacy }).toEqual({
        weightPercent: 100,
        privacy: "visible",
      });

      const result = await editCommitment(app, andrea, {
        seasonId: season.id,
        commitmentId: mine.id,
        ...change,
        measure: DONE_3,
      });

      expect(result.ok).toBe(true);
      const stored = await storedSeason(app, season.id);
      expect(stored.approvals).toEqual([]);
      expect(stored.pactRevision).toBe(season.pactRevision + 1);
    },
  );

  it("PI-S14: a non-owner's identical edit is NotOwner, not a silent no-op", async () => {
    const app = createTestApp({ now: NOW });
    const { season, victor } = await givenOpenPactWithOneApproval(app);
    const andreas = season.commitments[0];
    if (!andreas) throw new Error("fixture setup failed");

    const result = await editCommitment(app, victor, {
      seasonId: season.id,
      commitmentId: andreas.id,
      weightPercent: andreas.weightPercent,
      privacy: andreas.privacy,
      measure: DONE_3,
    });

    expect(result).toEqual({ ok: false, error: { kind: "NotOwner" } });
  });

  it("an identical edit still fails validation first when the input is invalid", async () => {
    const app = createTestApp({ now: NOW });
    const { season, andrea } = await givenOpenPactWithOneApproval(app);
    const mine = season.commitments[0];
    if (!mine) throw new Error("fixture setup failed");

    const result = await editCommitment(app, andrea, {
      seasonId: season.id,
      commitmentId: mine.id,
      weightPercent: 7,
      privacy: mine.privacy,
      measure: DONE_3,
    });

    expect(result.ok).toBe(false);
  });
});

describe("editCommitment", () => {
  it("a commitment's habitId is not editable: a stray habitId in the input is ignored (2026-09-30)", async () => {
    const app = createTestApp({ now: NOW });
    const { season, commitment } = await seasonWithCommitment(app);
    if (!commitment) throw new Error("fixture setup failed");
    const input = {
      seasonId: season.id,
      commitmentId: commitment.id,
      weightPercent: 35,
      privacy: "private" as const,
      measure: { unit: "done" as const, frequency: { kind: "timesPerWeek" as const, times: 5 } },
      habitId: habitId("habit-other"),
    };

    const result = await editCommitment(app, actorFor("user-andrea"), input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.commitments[0]?.habitId).toBe(habitId("habit-run"));
  });

  it("SS-13: edits the actor's own commitment while the pact is open", async () => {
    const app = createTestApp({ now: NOW });
    const { season, commitment } = await seasonWithCommitment(app);
    if (!commitment) throw new Error("fixture setup failed");

    const result = await editCommitment(app, actorFor("user-andrea"), {
      seasonId: season.id,
      commitmentId: commitment.id,
      weightPercent: 35,
      privacy: "private",
      measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 5 } },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.commitments).toHaveLength(1);
    expect(result.value.commitments[0]?.weightPercent).toBe(35);
    expect(result.value.commitments[0]?.privacy).toBe("private");
    expect(result.value.version).toBe(season.version + 1);
  });

  it("rejects an unknown commitment id", async () => {
    const app = createTestApp({ now: NOW });
    const { season } = await seasonWithCommitment(app);

    const result = await editCommitment(app, actorFor("user-andrea"), {
      seasonId: season.id,
      commitmentId: commitmentId("commitment-ghost"),
      weightPercent: 35,
      privacy: "private",
      measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 5 } },
    });

    expect(result).toEqual({ ok: false, error: { kind: "CommitmentNotFound" } });
  });

  it("SS-16: rejects editing another member's commitment", async () => {
    const app = createTestApp({ now: NOW });
    const { circle, season, commitment } = await seasonWithCommitment(app);
    if (!commitment) throw new Error("fixture setup failed");
    const invite = await generateInvite(app, actorFor("user-andrea"), { circleId: circle.id });
    if (!invite.ok) throw new Error("fixture setup failed");
    const joined = await joinCircle(app, actorFor("user-victor"), {
      inviteCode: invite.value.code,
    });
    if (!joined.ok) throw new Error("fixture setup failed");

    const result = await editCommitment(app, actorFor("user-victor"), {
      seasonId: season.id,
      commitmentId: commitment.id,
      weightPercent: 35,
      privacy: "private",
      measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 5 } },
    });

    expect(result).toEqual({ ok: false, error: { kind: "NotOwner" } });
  });

  it("SS-15: rejects editing once the pact is closed (active season)", async () => {
    const app = createTestApp({ now: NOW });
    const { season, commitment } = await seasonWithCommitment(app);
    if (!commitment) throw new Error("fixture setup failed");
    await app.uow.transaction(async (repos) => {
      await repos.seasons.save(
        { ...season, status: "active", version: season.version + 1 },
        season.version,
      );
      return ok(undefined);
    });

    const result = await editCommitment(app, actorFor("user-andrea"), {
      seasonId: season.id,
      commitmentId: commitment.id,
      weightPercent: 35,
      privacy: "private",
      measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 5 } },
    });

    expect(result).toEqual({ ok: false, error: { kind: "PactNotOpen" } });
  });

  it("propagates per-commitment validation errors (SS-11)", async () => {
    const app = createTestApp({ now: NOW });
    const { season, commitment } = await seasonWithCommitment(app);
    if (!commitment) throw new Error("fixture setup failed");

    const result = await editCommitment(app, actorFor("user-andrea"), {
      seasonId: season.id,
      commitmentId: commitment.id,
      weightPercent: 20,
      privacy: "visible",
      measure: {
        unit: "custom",
        customLabel: "a".repeat(21),
        direction: "reach",
        minimum: "1",
        ideal: "2",
        schedule: { period: "weeklyTotal" },
      },
    });

    expect(result).toEqual({ ok: false, error: { kind: "CustomLabelTooLong" } });
  });

  it("propagates precision errors: InvalidPrecision and PrecisionNotApplicable", async () => {
    const app = createTestApp({ now: NOW });
    const { season, commitment } = await seasonWithCommitment(app);
    if (!commitment) throw new Error("fixture setup failed");
    const edit = (unit: "custom" | "times", precision: string) =>
      editCommitment(app, actorFor("user-andrea"), {
        seasonId: season.id,
        commitmentId: commitment.id,
        weightPercent: 20,
        privacy: "visible",
        measure: {
          unit,
          direction: "reach",
          minimum: "1",
          ideal: "2",
          schedule: { period: "weeklyTotal" },
          precision: precision as "integer",
        },
      });

    expect(await edit("custom", "whole")).toEqual({
      ok: false,
      error: { kind: "InvalidPrecision" },
    });
    expect(await edit("times", "decimal")).toEqual({
      ok: false,
      error: { kind: "PrecisionNotApplicable" },
    });
  });

  it("D5: two concurrent edits of the same commitment race on the season's version -- exactly one commits, the loser gets ConcurrencyConflict", async () => {
    const app = createTestApp({ now: NOW });
    const { season, commitment } = await seasonWithCommitment(app);
    if (!commitment) throw new Error("fixture setup failed");

    const [a, b] = await Promise.allSettled([
      editCommitment(app, actorFor("user-andrea"), {
        seasonId: season.id,
        commitmentId: commitment.id,
        weightPercent: 25,
        privacy: "visible",
        measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } },
      }),
      editCommitment(app, actorFor("user-andrea"), {
        seasonId: season.id,
        commitmentId: commitment.id,
        weightPercent: 30,
        privacy: "visible",
        measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } },
      }),
    ]);

    const settled = [a, b];
    const fulfilled = settled.filter((r) => r.status === "fulfilled");
    const rejected = settled.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyConflict);
  });
});
