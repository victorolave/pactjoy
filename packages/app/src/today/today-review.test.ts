import { describe, expect, it } from "vitest";
import { dateOfDay, givenReviewWorld, type ReviewWorld } from "../review/review-fixtures.ts";
import { submitReview } from "../review/submit-review.ts";
import { seasonId } from "../shared/ids.ts";
import { localDate } from "../time/local-date.ts";
import { today } from "./today.query.ts";

const SEASON = seasonId("season-1");

/** Today for Andrea (or `actor`) on 1-based season day `day`. */
const todayOn = (world: ReviewWorld, day: number, actor = world.andrea) =>
  today(world.at(day), actor);

const itemOne = (world: ReviewWorld) => [
  { commitmentId: world.meditar, items: [4, null, null, null] },
  { commitmentId: world.leer, items: [4, null, null, null] },
];

describe("today: reviews", () => {
  it("SC-01: an active season carries the pending review and no baseline offer", async () => {
    const world = await givenReviewWorld();
    const view = await todayOn(world, 15);
    expect(view.state).toBe("active");
    expect(view).toMatchObject({
      pendingReview: {
        seasonId: SEASON,
        periodIndex: 1,
        kind: "interim",
        fullSrbai: false,
        firstWeek: 1,
        lastWeek: 2,
        dueUntil: dateOfDay(28),
        summaryAvailable: true,
      },
      baselineOffer: null,
    });
  });

  it("SC-40: the baseline offer shows in week 1 and never together with a review", async () => {
    const world = await givenReviewWorld();
    const view = await todayOn(world, 3);
    expect(view).toMatchObject({
      pendingReview: null,
      baselineOffer: { seasonId: SEASON, periodIndex: 0, offeredUntil: dateOfDay(7) },
    });
  });

  it("is also offered before the start day, once the pact is closed (notStarted)", async () => {
    const world = await givenReviewWorld();
    await world.app.uow.transaction(async (repos) => {
      const season = await repos.seasons.get(SEASON);
      if (!season) throw new Error("no season");
      await repos.seasons.save({ ...season, actualStart: localDate("2026-10-10"), version: 1 }, 0);
      return { ok: true, value: undefined };
    });
    const view = await todayOn(world, 1);
    expect(view.state).toBe("notStarted");
    expect(view).toMatchObject({ baselineOffer: { periodIndex: 0 }, pendingReview: null });
  });

  it("an open pact has neither", async () => {
    const world = await givenReviewWorld();
    await world.app.uow.transaction(async (repos) => {
      const season = await repos.seasons.get(SEASON);
      if (!season) throw new Error("no season");
      await repos.seasons.save(
        { ...season, status: "pactOpen", actualStart: null, pactClosedAt: null, version: 1 },
        0,
      );
      return { ok: true, value: undefined };
    });
    const view = await todayOn(world, 3);
    expect(view.state).toBe("pactOpen");
    expect(view).toMatchObject({ pendingReview: null, baselineOffer: null });
  });

  it("T4: the closing review appears once the season ended, and stays", async () => {
    const world = await givenReviewWorld();
    const view = await todayOn(world, 70);
    expect(view.state).toBe("ended");
    expect(view).toMatchObject({ pendingReview: { periodIndex: 4, kind: "closing" } });
  });

  it("SC-05: after the member submits, the card is gone", async () => {
    const world = await givenReviewWorld();
    const result = await submitReview(world.at(16), world.andrea, {
      seasonId: SEASON,
      periodIndex: 1,
      reflection: { helped: null, hard: null },
      automaticity: itemOne(world),
    });
    expect(result.ok).toBe(true);
    expect(await todayOn(world, 17)).toMatchObject({ pendingReview: null, baselineOffer: null });
  });

  it("SC-07: reading Today twice gives the same answer (the store check is in pending-review.test.ts)", async () => {
    const world = await givenReviewWorld();
    expect(await todayOn(world, 15)).toEqual(await todayOn(world, 15));
  });

  it("each member sees only their own review state", async () => {
    const world = await givenReviewWorld();
    await submitReview(world.at(16), world.andrea, {
      seasonId: SEASON,
      periodIndex: 1,
      reflection: { helped: "secreto", hard: null },
      automaticity: itemOne(world),
    });
    const victor = await todayOn(world, 17, world.victor);
    expect(victor).toMatchObject({ pendingReview: { periodIndex: 1 } });
    expect(JSON.stringify(victor)).not.toContain("secreto");
  });

  it("a member with no commitment has neither", async () => {
    const world = await givenReviewWorld({ andreaWithoutCommitments: true });
    expect(await todayOn(world, 15)).toMatchObject({ pendingReview: null, baselineOffer: null });
  });

  it("SC-104: answering a review leaves the points as they were", async () => {
    const world = await givenReviewWorld();
    const before = await todayOn(world, 16);
    await submitReview(world.at(16), world.andrea, {
      seasonId: SEASON,
      periodIndex: 1,
      reflection: { helped: null, hard: null },
      automaticity: itemOne(world),
    });
    const after = await todayOn(world, 16);
    expect(after.state === "active" && before.state === "active" && after.summary).toEqual(
      before.state === "active" && before.summary,
    );
  });
});
