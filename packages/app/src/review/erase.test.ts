import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { commitmentId } from "../commitment/commitment.ts";
import { reviewId, seasonId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { reviewFixture } from "../testing/builders.ts";
import { dropSeasonReviews, eraseMemberReviews } from "./erase.ts";
import { seedReview } from "./review-seed.ts";

const SEASON = seasonId("season-1");
const OTHER_SEASON = seasonId("season-2");
const ANDREA = memberId("member-andrea");
const VICTOR = memberId("member-victor");

const review = (id: string, member: typeof ANDREA, period: number, season = SEASON) =>
  reviewFixture({
    id: reviewId(id),
    seasonId: season,
    memberId: member,
    periodIndex: period,
    srbai: "full",
    reflection: { helped: "SENTINEL-helped", hard: "SENTINEL-hard" },
    responses: [{ commitmentId: commitmentId("c-1"), items: [4, 4, 5, 5] }],
  });

async function seeded() {
  const app = createTestApp();
  await seedReview(app, review("r-a1", ANDREA, 1));
  await seedReview(app, review("r-a2", ANDREA, 2, OTHER_SEASON));
  await seedReview(app, review("r-v1", VICTOR, 1));
  return app;
}

describe("eraseMemberReviews", () => {
  it("deletes the member's reviews in every season and keeps a peer's", async () => {
    const app = await seeded();
    await app.uow.transaction(async (repos) => {
      await eraseMemberReviews(repos, [ANDREA]);
      return ok(undefined);
    });
    expect(await app.reviews.listMine(SEASON, ANDREA)).toEqual([]);
    expect(await app.reviews.listMine(OTHER_SEASON, ANDREA)).toEqual([]);
    expect((await app.reviews.listMine(SEASON, VICTOR)).map((r) => r.id)).toEqual([
      reviewId("r-v1"),
    ]);
  });

  it("is undone when the transaction rolls back", async () => {
    const app = await seeded();
    await expect(
      app.uow.transaction(async (repos) => {
        await eraseMemberReviews(repos, [ANDREA, VICTOR]);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await app.reviews.listMine(SEASON, ANDREA)).toHaveLength(1);
    expect(await app.reviews.listMine(SEASON, VICTOR)).toHaveLength(1);
  });
});

describe("dropSeasonReviews", () => {
  it("deletes every member's reviews of the seasons and keeps other seasons", async () => {
    const app = await seeded();
    await app.uow.transaction(async (repos) => {
      await dropSeasonReviews(repos, [SEASON]);
      return ok(undefined);
    });
    expect(await app.reviews.listMine(SEASON, ANDREA)).toEqual([]);
    expect(await app.reviews.listMine(SEASON, VICTOR)).toEqual([]);
    expect(await app.reviews.listMine(OTHER_SEASON, ANDREA)).toHaveLength(1);
  });
});
