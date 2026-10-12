import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { seasonId, userId } from "../shared/ids.ts";
import { givenReviewWorld, type ReviewWorld } from "./review-fixtures.ts";
import { skipBaseline } from "./skip-baseline.ts";
import { submitReview } from "./submit-review.ts";

const SEASON = seasonId("season-1");
const ANDREA = memberId("member-andrea");

const skip = (world: ReviewWorld, day: number, periodIndex = 0, actor = world.andrea) =>
  skipBaseline(world.at(day), actor, { seasonId: SEASON, periodIndex });
const stored = (world: ReviewWorld) => world.app.reviews.listMine(SEASON, ANDREA);

describe("skipBaseline", () => {
  it("SC-41: stores a skipped baseline with no answers and no reflection", async () => {
    const world = await givenReviewWorld();
    const app = world.at(4);
    const result = await skipBaseline(app, world.andrea, { seasonId: SEASON, periodIndex: 0 });
    expect(result.ok).toBe(true);
    const rows = await stored(world);
    expect(rows).toEqual([
      {
        id: rows[0]?.id,
        seasonId: SEASON,
        memberId: ANDREA,
        periodIndex: 0,
        kind: "baseline",
        status: "skipped",
        srbai: null,
        reflection: { helped: null, hard: null },
        responses: [],
        recordedAt: app.clock.now(),
        version: 0,
      },
    ]);
  });

  it("skipping again, or answering after a skip, is refused and stores no second record", async () => {
    const world = await givenReviewWorld();
    await skip(world, 4);
    expect(await skip(world, 5)).toEqual({ ok: false, error: { kind: "ReviewAlreadySubmitted" } });
    const answered = await submitReview(world.at(5), world.andrea, {
      seasonId: SEASON,
      periodIndex: 0,
      reflection: { helped: null, hard: null },
      automaticity: [
        { commitmentId: world.meditar, items: [4, 4, 4, 4] },
        { commitmentId: world.leer, items: [4, 4, 4, 4] },
      ],
    });
    expect(answered).toEqual({ ok: false, error: { kind: "ReviewAlreadySubmitted" } });
    expect(await stored(world)).toHaveLength(1);
  });

  it("only the baseline can be skipped, even when another review is due", async () => {
    const world = await givenReviewWorld();
    for (const periodIndex of [1, 2, 4]) {
      expect(await skip(world, 15, periodIndex)).toEqual({
        ok: false,
        error: { kind: "ReviewNotSkippable" },
      });
    }
    expect(await stored(world)).toEqual([]);
  });

  it("the baseline cannot be skipped after day 7: the offer already lapsed", async () => {
    const world = await givenReviewWorld();
    expect(await skip(world, 8)).toEqual({
      ok: false,
      error: { kind: "ReviewNotDue", reason: "lapsed" },
    });
    expect(await stored(world)).toEqual([]);
  });

  it("a period that does not exist is not found", async () => {
    const world = await givenReviewWorld();
    expect(await skip(world, 4, 9)).toEqual({ ok: false, error: { kind: "ReviewPeriodNotFound" } });
  });

  it("only an active member of a running season can skip", async () => {
    const world = await givenReviewWorld();
    const stranger = { userId: userId("user-stranger") };
    expect(await skip(world, 4, 0, stranger)).toEqual({ ok: false, error: { kind: "NotAMember" } });
    const missing = await skipBaseline(world.at(4), world.andrea, {
      seasonId: seasonId("nope"),
      periodIndex: 0,
    });
    expect(missing).toEqual({ ok: false, error: { kind: "SeasonNotFound" } });
  });

  it("a member with no commitment has no baseline to skip", async () => {
    const world = await givenReviewWorld({ andreaWithoutCommitments: true });
    expect(await skip(world, 4)).toEqual({ ok: false, error: { kind: "ReviewPeriodNotFound" } });
  });
});
