import { describe, expect, it } from "vitest";
import {
  dateOfDay,
  givenReviewWorld,
  logMinutes,
  type ReviewWorld,
} from "../../review/review-fixtures.ts";
import {
  answerClosingReview,
  givenNextSeason,
  givenSeasonClosed,
  SEASON,
  submitClosureAs,
} from "./closure-world.ts";
import { seasonHistory } from "./season-history.query.ts";

const history = (world: ReviewWorld, day: number, who: "andrea" | "victor" = "andrea") =>
  seasonHistory(world.at(day), who === "andrea" ? world.andrea : world.victor);

describe("seasonHistory (Perfil, Temporadas)", () => {
  it("lists the circle's closed seasons the viewer took part in, with their figures", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await logMinutes(world, "meditar", 1);
    await givenSeasonClosed(world);

    const result = await history(world, 40);

    expect(result.seasons).toEqual([
      {
        seasonId: SEASON,
        lengthWeeks: 4,
        actualStart: dateOfDay(1),
        lastDay: dateOfDay(28),
        points: expect.any(Number),
        rank: 1,
        memberCount: 2,
        closedByMe: true,
      },
    ]);
    expect(result.seasons[0]?.points).toBeGreaterThan(0);
  });

  it("closedByMe is the viewer's own closure only: a laggard cut off reads false", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await answerClosingReview(world, "andrea");
    await submitClosureAs(world, "andrea", 30);
    await givenNextSeason(world, 36);

    expect((await history(world, 40)).seasons.map((s) => s.closedByMe)).toEqual([true]);
    expect((await history(world, 40, "victor")).seasons.map((s) => s.closedByMe)).toEqual([false]);
  });

  it("leaves out seasons that are not closed, and seasons the viewer held no commitment in", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    expect((await history(world, 10)).seasons).toEqual([]);

    const noCommitments = await givenReviewWorld({
      lengthWeeks: 4,
      andreaWithoutCommitments: true,
    });
    await answerClosingReview(noCommitments, "victor");
    await submitClosureAs(noCommitments, "victor", 30);
    expect((await history(noCommitments, 40)).seasons).toEqual([]);
    expect((await history(noCommitments, 40, "victor")).seasons).toHaveLength(1);
  });

  it("a user with no circle has an empty history", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    expect(await seasonHistory(world.at(40), { userId: "user-nobody" as never })).toEqual({
      seasons: [],
    });
  });
});
