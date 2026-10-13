import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { commitmentId } from "../commitment/commitment.ts";
import { loadEffectivePauses } from "../pause/effective-pauses.ts";
import { circleId, habitId, seasonId, userId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import { instant } from "../time/instant.ts";
import { commitmentStage, commitmentStages } from "./commitment-stage.query.ts";
import { givenReviewWorld, logMinutes, type ReviewWorld } from "./review-fixtures.ts";
import { submitReview } from "./submit-review.ts";

const SEASON = seasonId("season-1");

const stageOn = async (world: ReviewWorld, day: number, which: "meditar" | "leer" = "meditar") => {
  const result = await commitmentStage(world.at(day), world.andrea, {
    seasonId: SEASON,
    commitmentId: world[which],
  });
  if (!result.ok) throw new Error(`stage refused: ${result.error.kind}`);
  return result.value.stage;
};

/** Graduates one of Andrea's habits, bypassing the closure use case (GIVEN state). */
async function graduate(world: ReviewWorld, id: string) {
  await world.app.uow.transaction(async (repos) => {
    const habit = await repos.habits.get(habitId(id));
    if (!habit) throw new Error("fixture missing");
    await repos.habits.save(
      { ...habit, graduatedAt: instant(1), version: habit.version + 1 },
      habit.version,
    );
    return ok(undefined);
  });
}

async function logDays(world: ReviewWorld, from: number, to: number) {
  for (let day = from; day <= to; day++) await logMinutes(world, "meditar", day);
}

/** The baseline at day 3, so the member has an automaticity score for Meditar. */
async function answerBaseline(world: ReviewWorld, meditar: number) {
  const result = await submitReview(world.at(3), world.andrea, {
    seasonId: SEASON,
    periodIndex: 0,
    reflection: { helped: null, hard: null },
    automaticity: [
      { commitmentId: world.meditar, items: [meditar, meditar, meditar, meditar] },
      { commitmentId: world.leer, items: [3, 3, 3, 3] },
    ],
  });
  expect(result.ok).toBe(true);
}

describe("commitmentStage", () => {
  it("SC-90: is new while no review period has ended", async () => {
    const world = await givenReviewWorld();
    await logDays(world, 0, 5);
    expect(await stageOn(world, 10)).toBe("new");
  });

  it("SC-91: is developing once the last ended period kept at least 60%", async () => {
    const world = await givenReviewWorld();
    await logDays(world, 0, 13);
    expect(await stageOn(world, 16)).toBe("developing");
  });

  it("is new when the last ended period stayed below 60%", async () => {
    const world = await givenReviewWorld();
    await logDays(world, 0, 7);
    expect(await stageOn(world, 16)).toBe("new");
  });

  it("SC-92: is integrated after four strong weeks and a latest automaticity of 5", async () => {
    const world = await givenReviewWorld();
    await answerBaseline(world, 5);
    await logDays(world, 0, 27);
    expect(await stageOn(world, 30)).toBe("integrated");
  });

  it("SC-99: four strong weeks without any automaticity score stay developing", async () => {
    const world = await givenReviewWorld();
    await logDays(world, 0, 27);
    expect(await stageOn(world, 30)).toBe("developing");
  });

  it("SC-92: an automaticity below 5 stays developing", async () => {
    const world = await givenReviewWorld();
    await answerBaseline(world, 4);
    await logDays(world, 0, 27);
    expect(await stageOn(world, 30)).toBe("developing");
  });

  it("SC-94: regresses to new when the last period falls below 60%", async () => {
    const world = await givenReviewWorld();
    await answerBaseline(world, 6);
    await logDays(world, 0, 27);
    expect(await stageOn(world, 30)).toBe("integrated");
    // Weeks 5-6 (period 3) with nothing logged: 0 of 14 once they are final.
    expect(await stageOn(world, 44)).toBe("new");
  });

  it("is new before the season starts and while the pact is open", async () => {
    const world = await givenReviewWorld();
    expect(await stageOn(world, 0)).toBe("new");
  });

  it("REQ-H9: a strong habit is never graduated by the stage alone (only the owner decides)", async () => {
    const world = await givenReviewWorld();
    await answerBaseline(world, 7);
    await logDays(world, 0, 55);
    expect(await stageOn(world, 70)).not.toBe("graduated");
  });

  it("SC-G5/REQ-H3: a habit with graduatedAt reads graduated, for its own commitment only, and it is not stored", async () => {
    const world = await givenReviewWorld();
    await graduate(world, "habit-meditar");
    expect(await stageOn(world, 16)).toBe("graduated");
    expect(await stageOn(world, 16, "leer")).toBe("new");
    const stored = await world.app.uow.read((repos) => repos.habits.get(habitId("habit-meditar")));
    expect(stored?.version).toBe(1);
  });

  it("a graduated habit reads graduated even in a season that has not started", async () => {
    const world = await givenReviewWorld();
    await graduate(world, "habit-leer");
    expect(await stageOn(world, 0, "leer")).toBe("graduated");
  });

  it("commitmentStages derives every own commitment at once, with graduated wired per habit", async () => {
    const world = await givenReviewWorld();
    await graduate(world, "habit-leer");
    const app = world.at(16);
    const stages = await app.uow.read(async (repos) => {
      const season = await repos.seasons.get(SEASON);
      const circle = await repos.circles.get(circleId("circle-1"));
      if (!season || !circle) throw new Error("fixture missing");
      return commitmentStages(app, repos, {
        season,
        circle,
        memberId: memberId("member-andrea"),
      });
    });
    expect([...stages.entries()].sort()).toEqual(
      [
        [world.meditar, "new"],
        [world.leer, "graduated"],
      ].sort(),
    );
  });

  it("reuses preloaded score data: same stages, and no entries or pauses read (profile-habits-consistency P9)", async () => {
    const world = await givenReviewWorld();
    await logDays(world, 0, 13);
    const app = world.at(16);
    const { without, withData, reads } = await app.uow.read(async (repos) => {
      const season = await repos.seasons.get(SEASON);
      const circle = await repos.circles.get(circleId("circle-1"));
      if (!season || !circle) throw new Error("fixture missing");
      const input = { season, circle, memberId: memberId("member-andrea") };
      const without = await commitmentStages(app, repos, input);
      const data = {
        entries: await repos.entries.listBySeason(SEASON),
        pauses: await loadEffectivePauses(repos, {
          season,
          circle,
          now: app.clock.now(),
          timeZone: app.timeZone,
        }),
      };
      const reads: string[] = [];
      const spy = new Proxy(repos, {
        get(target, key, receiver) {
          const value = Reflect.get(target, key, receiver);
          if ((key === "entries" || key === "pauses") && typeof value === "object") {
            reads.push(String(key));
          }
          return value;
        },
      });
      const withData = await commitmentStages(app, spy, { ...input, data });
      return { without, withData, reads };
    });
    expect(withData).toEqual(without);
    expect([...withData.values()]).toContain("developing");
    expect(reads).toEqual([]);
  });

  it("SC-101/105: only the owner reads it; anyone else gets not found", async () => {
    const world = await givenReviewWorld();
    const peer = await commitmentStage(world.at(16), world.victor, {
      seasonId: SEASON,
      commitmentId: world.meditar,
    });
    expect(peer).toEqual({ ok: false, error: { kind: "CommitmentNotFound" } });
    const ghost = await commitmentStage(world.at(16), world.andrea, {
      seasonId: SEASON,
      commitmentId: commitmentId("ghost"),
    });
    expect(ghost).toEqual({ ok: false, error: { kind: "CommitmentNotFound" } });
  });

  it("refuses strangers and unknown seasons", async () => {
    const world = await givenReviewWorld();
    expect(
      await commitmentStage(
        world.at(16),
        { userId: userId("user-stranger") },
        {
          seasonId: SEASON,
          commitmentId: world.meditar,
        },
      ),
    ).toEqual({ ok: false, error: { kind: "NotAMember" } });
    expect(
      await commitmentStage(world.at(16), world.andrea, {
        seasonId: seasonId("nope"),
        commitmentId: world.meditar,
      }),
    ).toEqual({ ok: false, error: { kind: "SeasonNotFound" } });
  });

  it("the result carries only the commitment id and the stage", async () => {
    const world = await givenReviewWorld();
    const result = await commitmentStage(world.at(16), world.andrea, {
      seasonId: SEASON,
      commitmentId: world.meditar,
    });
    expect(result).toEqual({ ok: true, value: { commitmentId: world.meditar, stage: "new" } });
  });
});
