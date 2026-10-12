import { describe, expect, it } from "vitest";
import { commitmentId } from "../commitment/commitment.ts";
import { seasonId, userId } from "../shared/ids.ts";
import { commitmentStage } from "./commitment-stage.query.ts";
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

  it("is never graduated (no graduation path yet)", async () => {
    const world = await givenReviewWorld();
    await answerBaseline(world, 7);
    await logDays(world, 0, 55);
    expect(await stageOn(world, 70)).not.toBe("graduated");
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
