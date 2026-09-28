import { describe, expect, it } from "vitest";
import { createCircle } from "../circle/create-circle.ts";
import { generateInvite } from "../circle/generate-invite.ts";
import { joinCircle } from "../circle/join-circle.ts";
import { createSeason } from "../season/create-season.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { habitId, userId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { instant } from "../time/instant.ts";
import { addCommitment } from "./add-commitment.ts";
import { commitmentId } from "./commitment.ts";
import { editCommitment } from "./edit-commitment.ts";

function actorFor(id: string) {
  return { userId: userId(id) };
}

const NOW = instant(1_759_060_800_000); // 2025-09-28T12:00:00.000Z

async function seasonWithCommitment(app: ReturnType<typeof createTestApp>) {
  const circle = await createCircle(app, actorFor("user-andrea"), { name: "Río Runners" });
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

describe("editCommitment", () => {
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
