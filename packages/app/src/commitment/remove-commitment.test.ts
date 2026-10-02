import { describe, expect, it } from "vitest";
import { createCircle } from "../circle/create-circle.ts";
import { generateInvite } from "../circle/generate-invite.ts";
import { joinCircle } from "../circle/join-circle.ts";
import { createSeason } from "../season/create-season.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { habitId, userId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { createCircleInput, joinCircleInput } from "../testing/circle-inputs.ts";
import { instant } from "../time/instant.ts";
import { addCommitment } from "./add-commitment.ts";
import { commitmentId } from "./commitment.ts";
import { removeCommitment } from "./remove-commitment.ts";

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

describe("removeCommitment", () => {
  it("removes the actor's own commitment while the pact is open", async () => {
    const app = createTestApp({ now: NOW });
    const { season, commitment } = await seasonWithCommitment(app);
    if (!commitment) throw new Error("fixture setup failed");

    const result = await removeCommitment(app, actorFor("user-andrea"), {
      seasonId: season.id,
      commitmentId: commitment.id,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.commitments).toHaveLength(0);
    expect(result.value.version).toBe(season.version + 1);
  });

  it("rejects an unknown commitment id", async () => {
    const app = createTestApp({ now: NOW });
    const { season } = await seasonWithCommitment(app);

    const result = await removeCommitment(app, actorFor("user-andrea"), {
      seasonId: season.id,
      commitmentId: commitmentId("commitment-ghost"),
    });

    expect(result).toEqual({ ok: false, error: { kind: "CommitmentNotFound" } });
  });

  it("SS-16-delta: rejects removing another member's commitment", async () => {
    const app = createTestApp({ now: NOW });
    const { circle, season, commitment } = await seasonWithCommitment(app);
    if (!commitment) throw new Error("fixture setup failed");
    const invite = await generateInvite(app, actorFor("user-andrea"), { circleId: circle.id });
    if (!invite.ok) throw new Error("fixture setup failed");
    const joined = await joinCircle(
      app,
      actorFor("user-victor"),
      joinCircleInput(invite.value.code),
    );
    if (!joined.ok) throw new Error("fixture setup failed");

    const result = await removeCommitment(app, actorFor("user-victor"), {
      seasonId: season.id,
      commitmentId: commitment.id,
    });

    expect(result).toEqual({ ok: false, error: { kind: "NotOwner" } });
  });

  it("SS-15-delta: rejects removing once the pact is closed (active season)", async () => {
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

    const result = await removeCommitment(app, actorFor("user-andrea"), {
      seasonId: season.id,
      commitmentId: commitment.id,
    });

    expect(result).toEqual({ ok: false, error: { kind: "PactNotOpen" } });
  });

  it("D5: two concurrent removes of the same commitment race on the season's version -- exactly one commits, the loser gets ConcurrencyConflict", async () => {
    const app = createTestApp({ now: NOW });
    const { season, commitment } = await seasonWithCommitment(app);
    if (!commitment) throw new Error("fixture setup failed");

    const [a, b] = await Promise.allSettled([
      removeCommitment(app, actorFor("user-andrea"), {
        seasonId: season.id,
        commitmentId: commitment.id,
      }),
      removeCommitment(app, actorFor("user-andrea"), {
        seasonId: season.id,
        commitmentId: commitment.id,
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
