import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { reviewId, seasonId } from "../shared/ids.ts";
import { reviewFixture } from "../testing/builders.ts";
import { pendingReviewOf } from "./pending-review.ts";
import { dateOfDay, givenReviewWorld, type ReviewWorld } from "./review-fixtures.ts";

const SEASON = seasonId("season-1");
const ANDREA = memberId("member-andrea");
const VICTOR = memberId("member-victor");

/** What Today would be told for `who` on 1-based season day `day`. */
async function offerAt(world: ReviewWorld, day: number, who = ANDREA) {
  return world.app.uow.read(async (repos) => {
    const season = await repos.seasons.get(SEASON);
    if (!season) throw new Error("no season");
    return pendingReviewOf(repos, { season, memberId: who, today: dateOfDay(day) });
  });
}

let seq = 0;
async function store(world: ReviewWorld, periodIndex: number, status: "completed" | "skipped") {
  seq += 1;
  const baseline = periodIndex === 0;
  await world.app.reviews.save(
    reviewFixture({
      id: reviewId(`stored-${seq}`),
      seasonId: SEASON,
      memberId: ANDREA,
      periodIndex,
      kind: baseline ? "baseline" : "interim",
      status,
      srbai: status === "skipped" ? null : "item1",
    }),
    null,
  );
}

describe("pendingReviewOf: due, lapse and no accumulation (8 weeks, cadence 2)", () => {
  it("SC-01: the interim review is pending from the first day of period 2 (day 15), not on day 14", async () => {
    const world = await givenReviewWorld();
    expect((await offerAt(world, 14)).pendingReview).toBeNull();
    expect((await offerAt(world, 15)).pendingReview).toEqual({
      seasonId: "season-1",
      periodIndex: 1,
      kind: "interim",
      fullSrbai: false,
      firstWeek: 1,
      lastWeek: 2,
      dueUntil: dateOfDay(28),
      summaryAvailable: true,
    });
  });

  it("SC-02: it is still pending mid-period and SC-03 it lapses into the next one on day 29", async () => {
    const world = await givenReviewWorld();
    expect((await offerAt(world, 22)).pendingReview?.periodIndex).toBe(1);
    expect((await offerAt(world, 28)).pendingReview?.periodIndex).toBe(1);
    const next = (await offerAt(world, 29)).pendingReview;
    expect(next).toMatchObject({ periodIndex: 2, kind: "interim", fullSrbai: true });
  });

  it("SC-04: ignored periods do not accumulate: only the latest due one is offered", async () => {
    const world = await givenReviewWorld();
    expect((await offerAt(world, 43)).pendingReview).toMatchObject({ periodIndex: 3 });
  });

  it("SC-05: a submitted review stops being pending", async () => {
    const world = await givenReviewWorld();
    await store(world, 1, "completed");
    expect((await offerAt(world, 20)).pendingReview).toBeNull();
  });

  it("SC-06: the last interim review gives way to the closing one, which never lapses", async () => {
    const world = await givenReviewWorld();
    expect((await offerAt(world, 56)).pendingReview).toMatchObject({
      periodIndex: 3,
      kind: "interim",
    });
    const closing = (await offerAt(world, 57)).pendingReview;
    expect(closing).toMatchObject({ periodIndex: 4, kind: "closing", fullSrbai: true });
    expect(closing?.dueUntil).toBeNull();
    expect((await offerAt(world, 70)).pendingReview?.periodIndex).toBe(4);
  });

  it("SC-07: reading the offer writes nothing", async () => {
    const world = await givenReviewWorld();
    await offerAt(world, 3);
    await offerAt(world, 15);
    await offerAt(world, 15);
    expect(await world.app.reviews.listMine(SEASON, ANDREA)).toEqual([]);
  });

  it("SC-08: nothing is pending or offered before the first period ends (day 14)", async () => {
    const world = await givenReviewWorld();
    await store(world, 0, "skipped");
    expect(await offerAt(world, 14)).toEqual({ pendingReview: null, baselineOffer: null });
  });

  it("SC-15: a solo circle gets the same reviews", async () => {
    const world = await givenReviewWorld({ solo: true, lengthWeeks: 4, cadence: 1 });
    expect((await offerAt(world, 8)).pendingReview).toMatchObject({ periodIndex: 1 });
    expect((await offerAt(world, 22)).pendingReview).toMatchObject({ periodIndex: 3 });
  });

  it("REQ-R9: a member with no commitment has no review and no baseline offer", async () => {
    const world = await givenReviewWorld({ andreaWithoutCommitments: true });
    expect(await offerAt(world, 3)).toEqual({ pendingReview: null, baselineOffer: null });
    expect(await offerAt(world, 15)).toEqual({ pendingReview: null, baselineOffer: null });
  });

  it("reviews are per member: Victor's own stored review does not hide Andrea's", async () => {
    const world = await givenReviewWorld();
    seq += 1;
    await world.app.reviews.save(
      reviewFixture({
        id: reviewId(`stored-${seq}`),
        seasonId: SEASON,
        memberId: VICTOR,
        periodIndex: 1,
      }),
      null,
    );
    expect((await offerAt(world, 15)).pendingReview).not.toBeNull();
    expect((await offerAt(world, 15, VICTOR)).pendingReview).toBeNull();
  });
});

describe("pendingReviewOf: the baseline offer", () => {
  it("SC-40: offered from the pact close through day 7, then gone", async () => {
    const world = await givenReviewWorld();
    for (const day of [1, 4, 7]) {
      expect(await offerAt(world, day)).toEqual({
        pendingReview: null,
        baselineOffer: { seasonId: "season-1", periodIndex: 0, offeredUntil: dateOfDay(7) },
      });
    }
    expect((await offerAt(world, 8)).baselineOffer).toBeNull();
  });

  it("is offered before the season starts, once the pact is closed", async () => {
    const world = await givenReviewWorld();
    const offer = await world.app.uow.read(async (repos) => {
      const season = await repos.seasons.get(SEASON);
      if (!season) throw new Error("no season");
      return pendingReviewOf(repos, { season, memberId: ANDREA, today: dateOfDay(0) });
    });
    expect(offer.baselineOffer).toMatchObject({ periodIndex: 0 });
  });

  it("is not offered while the pact is still open", async () => {
    const world = await givenReviewWorld();
    const offer = await world.app.uow.read(async (repos) => {
      const season = await repos.seasons.get(SEASON);
      if (!season) throw new Error("no season");
      return pendingReviewOf(repos, {
        season: { ...season, status: "pactOpen", actualStart: null, pactClosedAt: null },
        memberId: ANDREA,
        today: dateOfDay(1),
      });
    });
    expect(offer).toEqual({ pendingReview: null, baselineOffer: null });
  });

  it("SC-41: a stored skip (or a stored baseline) stops the offer", async () => {
    const world = await givenReviewWorld();
    await store(world, 0, "skipped");
    expect((await offerAt(world, 3)).baselineOffer).toBeNull();
  });

  it("SC-45: baseline and review never overlap (4 weeks, cadence 1)", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4, cadence: 1 });
    const d7 = await offerAt(world, 7);
    expect(d7.baselineOffer).not.toBeNull();
    expect(d7.pendingReview).toBeNull();
    const d8 = await offerAt(world, 8);
    expect(d8.baselineOffer).toBeNull();
    expect(d8.pendingReview).toMatchObject({ periodIndex: 1 });
  });

  it("never sets both at once, on any day of the season", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4, cadence: 1 });
    for (let day = 0; day <= 40; day++) {
      const { pendingReview, baselineOffer } = await offerAt(world, day);
      expect(pendingReview !== null && baselineOffer !== null).toBe(false);
    }
  });
});
