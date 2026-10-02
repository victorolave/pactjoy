import { describe, expect, it } from "vitest";
import { createCircle } from "../circle/create-circle.ts";
import { createSeason } from "../season/create-season.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { habitId, seasonId, userId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { createCircleInput } from "../testing/circle-inputs.ts";
import { instant } from "../time/instant.ts";
import { addCommitment } from "./add-commitment.ts";

function actorFor(id: string) {
  return { userId: userId(id) };
}

const NOW = instant(1_759_060_800_000); // 2025-09-28T12:00:00.000Z

async function seasonFor(app: ReturnType<typeof createTestApp>) {
  const circle = await createCircle(app, actorFor("user-andrea"), createCircleInput("Río Runners"));
  if (!circle.ok) throw new Error("fixture setup failed");
  const season = await createSeason(app, actorFor("user-andrea"), {
    circleId: circle.value.id,
    timezone: "America/Santiago",
    startDate: "2025-10-01",
    lengthWeeks: 8,
  });
  if (!season.ok) throw new Error("fixture setup failed");
  return { circle: circle.value, season: season.value };
}

describe("addCommitment", () => {
  it("SS-13: adds a commitment to the season while the pact is open", async () => {
    const app = createTestApp({ now: NOW });
    const { season } = await seasonFor(app);

    const result = await addCommitment(app, actorFor("user-andrea"), {
      seasonId: season.id,
      habitId: habitId("habit-run"),
      weightPercent: 20,
      privacy: "visible",
      measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.commitments).toHaveLength(1);
    expect(result.value.commitments[0]?.habitId).toBe("habit-run");
    expect(result.value.commitments[0]?.weightPercent).toBe(20);
    expect(result.value.version).toBe(season.version + 1);

    const stored = await app.uow.read((repos) => repos.seasons.get(season.id));
    expect(stored?.commitments).toHaveLength(1);
  });

  it("propagates precision errors: InvalidPrecision and PrecisionNotApplicable", async () => {
    const app = createTestApp({ now: NOW });
    const { season } = await seasonFor(app);
    const add = (unit: "custom" | "times", precision: string) =>
      addCommitment(app, actorFor("user-andrea"), {
        seasonId: season.id,
        habitId: habitId("habit-run"),
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

    expect(await add("custom", "whole")).toEqual({
      ok: false,
      error: { kind: "InvalidPrecision" },
    });
    expect(await add("times", "decimal")).toEqual({
      ok: false,
      error: { kind: "PrecisionNotApplicable" },
    });
  });

  it("rejects when the season does not exist", async () => {
    const app = createTestApp({ now: NOW });

    const result = await addCommitment(app, actorFor("user-andrea"), {
      seasonId: seasonId("season-ghost"),
      habitId: habitId("habit-run"),
      weightPercent: 20,
      privacy: "visible",
      measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } },
    });

    expect(result).toEqual({ ok: false, error: { kind: "SeasonNotFound" } });
  });

  it("rejects a non-member of the circle", async () => {
    const app = createTestApp({ now: NOW });
    const { season } = await seasonFor(app);

    const result = await addCommitment(app, actorFor("user-outsider"), {
      seasonId: season.id,
      habitId: habitId("habit-run"),
      weightPercent: 20,
      privacy: "visible",
      measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } },
    });

    expect(result).toEqual({ ok: false, error: { kind: "NotAMember" } });
  });

  it("SS-15: rejects adding once the pact is closed (active season)", async () => {
    const app = createTestApp({ now: NOW });
    const { season } = await seasonFor(app);
    await app.uow.transaction(async (repos) => {
      await repos.seasons.save(
        { ...season, status: "active", version: season.version + 1 },
        season.version,
      );
      return ok(undefined);
    });

    const result = await addCommitment(app, actorFor("user-andrea"), {
      seasonId: season.id,
      habitId: habitId("habit-run"),
      weightPercent: 20,
      privacy: "visible",
      measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } },
    });

    expect(result).toEqual({ ok: false, error: { kind: "PactNotOpen" } });
  });

  it("propagates per-commitment validation errors (SS-9)", async () => {
    const app = createTestApp({ now: NOW });
    const { season } = await seasonFor(app);

    const result = await addCommitment(app, actorFor("user-andrea"), {
      seasonId: season.id,
      habitId: habitId("habit-run"),
      weightPercent: 20,
      privacy: "visible",
      measure: {
        unit: "minutes",
        direction: "reach",
        minimum: "0",
        ideal: "30",
        schedule: { period: "weeklyTotal" },
      },
    });

    expect(result).toEqual({ ok: false, error: { kind: "MinimumNotPositive" } });
  });

  it("D5: two concurrent adds on the same season race on its version -- exactly one commits, the loser gets ConcurrencyConflict", async () => {
    const app = createTestApp({ now: NOW });
    const { season } = await seasonFor(app);

    const [a, b] = await Promise.allSettled([
      addCommitment(app, actorFor("user-andrea"), {
        seasonId: season.id,
        habitId: habitId("habit-run"),
        weightPercent: 20,
        privacy: "visible",
        measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } },
      }),
      addCommitment(app, actorFor("user-andrea"), {
        seasonId: season.id,
        habitId: habitId("habit-swim"),
        weightPercent: 30,
        privacy: "visible",
        measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 2 } },
      }),
    ]);

    const settled = [a, b];
    const fulfilled = settled.filter((r) => r.status === "fulfilled");
    const rejected = settled.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyConflict);
    expect(fulfilled[0]).toMatchObject({ value: { ok: true } });

    // The winner's write must survive the loser's rollback (ADR-0008, D5).
    const persisted = await app.seasons.get(season.id);
    expect(persisted?.commitments).toHaveLength(1);
  });
});
