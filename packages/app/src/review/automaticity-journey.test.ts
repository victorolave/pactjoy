import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { seasonId } from "../shared/ids.ts";
import { automaticityJourney, closingReviewDone } from "./automaticity-journey.ts";
import { givenReviewWorld, type ReviewWorld } from "./review-fixtures.ts";
import { skipBaseline } from "./skip-baseline.ts";
import { submitReview } from "./submit-review.ts";

const SEASON = seasonId("season-1");
const ANDREA = memberId("member-andrea");
type Items = readonly (number | null)[];

/** Answers a review of Andrea's two commitments on 1-based season day `day`. */
async function answer(
  world: ReviewWorld,
  day: number,
  periodIndex: number,
  meditar: Items,
  leer: Items = meditar,
) {
  const result = await submitReview(world.at(day), world.andrea, {
    seasonId: SEASON,
    periodIndex,
    reflection: { helped: null, hard: null },
    automaticity: [
      { commitmentId: world.meditar, items: meditar },
      { commitmentId: world.leer, items: leer },
    ],
  });
  if (!result.ok) throw new Error(`review ${periodIndex}: ${result.error.kind}`);
}

const journey = (world: ReviewWorld) =>
  world.app.uow.read(async (repos) => {
    const season = await repos.seasons.get(SEASON);
    if (!season) throw new Error("no season");
    return automaticityJourney(repos, season, ANDREA);
  });

const done = (world: ReviewWorld) =>
  world.app.uow.read(async (repos) => {
    const season = await repos.seasons.get(SEASON);
    if (!season) throw new Error("no season");
    return closingReviewDone(repos, season, ANDREA);
  });

const FULL_3 = [3, 3, 3, 3];
const FULL_45 = [4, 5, 4, 5];

describe("automaticityJourney (SC-RS1, SC-RS2)", () => {
  it("SC-RS1: the baseline is the start and the closing review the end", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await answer(world, 3, 0, FULL_3);
    await answer(world, 29, 2, FULL_45);

    const result = await journey(world);

    expect(result.get(world.meditar)).toEqual({ from: "3,0", to: "4,5" });
    expect(result.get(world.leer)).toEqual({ from: "3,0", to: "4,5" });
  });

  it("without a baseline, the earliest earlier review is the start (item 1 against item 1)", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4, cadence: 1 });
    await answer(world, 9, 1, [2, null, null, null]);
    await answer(world, 29, 4, [5, 7, 7, 7]);

    const result = await journey(world);

    expect(result.get(world.meditar)).toEqual({ from: "2,0", to: "5,0" });
  });

  it("a skipped baseline is absent: the interim review is the reference", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4, cadence: 1 });
    await skipBaseline(world.at(3), world.andrea, { seasonId: SEASON, periodIndex: 0 });
    await answer(world, 9, 1, [4, null, null, null]);
    await answer(world, 29, 4, FULL_45);

    expect((await journey(world)).get(world.meditar)).toEqual({ from: "4,0", to: "4,0" });
  });

  it("SC-RS2: only the closing review exists: it has an end and no start", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await answer(world, 29, 2, FULL_45);

    expect((await journey(world)).get(world.meditar)).toEqual({ from: null, to: "4,5" });
  });

  it("no closing review: neither side is known", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await answer(world, 3, 0, FULL_3);

    expect((await journey(world)).get(world.meditar)).toEqual({ from: null, to: null });
  });
});

describe("closingReviewDone", () => {
  it("is false until the closing review is completed, whatever else was answered", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4, cadence: 1 });
    await answer(world, 3, 0, FULL_3);
    await answer(world, 9, 1, [4, null, null, null]);
    expect(await done(world)).toBe(false);
    await answer(world, 29, 4, FULL_45);
    expect(await done(world)).toBe(true);
  });
});
