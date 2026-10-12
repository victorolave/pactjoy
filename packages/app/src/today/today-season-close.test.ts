import { describe, expect, it } from "vitest";
import { dateOfDay, givenReviewWorld, type ReviewWorld } from "../review/review-fixtures.ts";
import { answerClosingReview, SEASON, submitClosureAs } from "../season/closure/closure-world.ts";
import { type TodayView, today } from "./today.query.ts";

async function closeInfo(world: ReviewWorld, day: number, who: "andrea" | "victor" = "andrea") {
  const view: TodayView = await today(
    world.at(day),
    who === "andrea" ? world.andrea : world.victor,
  );
  if (view.state !== "active" && view.state !== "ended") throw new Error(`state ${view.state}`);
  return view.seasonClose;
}

const world4 = () => givenReviewWorld({ lengthWeeks: 4 });

describe("Today: seasonClose (REQ-T5, C10)", () => {
  it("is null while the season is running", async () => {
    const world = await world4();
    expect(await closeInfo(world, 10)).toBeNull();
    expect(await closeInfo(world, 28)).toBeNull();
  });

  it("closingReview while the closing review is pending (the review card owns it)", async () => {
    const world = await world4();
    expect(await closeInfo(world, 29)).toEqual({
      step: "closingReview",
      resultsFrom: dateOfDay(30),
      nextSeasonFrom: dateOfDay(36),
      nextSeasonOpen: false,
    });
    expect((await closeInfo(world, 33))?.step).toBe("closingReview");
  });

  it("resultsSoon on the grace day once the review is done, decide from the results day", async () => {
    const world = await world4();
    await answerClosingReview(world, "andrea");
    expect((await closeInfo(world, 29))?.step).toBe("resultsSoon");
    expect((await closeInfo(world, 30))?.step).toBe("decide");
    expect((await closeInfo(world, 33))?.step).toBe("decide");
  });

  it("waiting once the viewer closed, and for a viewer with nothing to close", async () => {
    const world = await world4();
    await answerClosingReview(world, "andrea");
    await submitClosureAs(world, "andrea", 30);
    expect((await closeInfo(world, 31))?.step).toBe("waiting");

    const noCommitments = await givenReviewWorld({
      lengthWeeks: 4,
      andreaWithoutCommitments: true,
    });
    expect((await closeInfo(noCommitments, 30))?.step).toBe("waiting");
  });

  it("nextSeasonOpen is a date fact: true from a week after the end", async () => {
    const world = await world4();
    expect((await closeInfo(world, 35))?.nextSeasonOpen).toBe(false);
    expect((await closeInfo(world, 36))?.nextSeasonOpen).toBe(true);
  });

  it("REQ-T8: it says nothing about the other members", async () => {
    const world = await world4();
    await answerClosingReview(world, "victor");
    const before = await closeInfo(world, 30, "victor");
    await answerClosingReview(world, "andrea");
    await submitClosureAs(world, "andrea", 30);
    expect(await closeInfo(world, 30, "victor")).toEqual(before);
  });

  it("REQ-T9: reading it writes nothing", async () => {
    const world = await world4();
    await answerClosingReview(world, "andrea");
    await answerClosingReview(world, "victor");
    await closeInfo(world, 36);
    expect(await world.app.uow.read((repos) => repos.seasons.get(SEASON))).toMatchObject({
      status: "active",
      version: 0,
    });
  });
});
