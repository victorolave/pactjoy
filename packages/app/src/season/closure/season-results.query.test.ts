import { describe, expect, it } from "vitest";
import { recordEntry } from "../../entry/record-entry.ts";
import {
  dateOfDay,
  givenReviewWorld,
  logMinutes,
  type ReviewWorld,
} from "../../review/review-fixtures.ts";
import { memberScore } from "../../score/member-score.query.ts";
import { userId } from "../../shared/ids.ts";
import { answerClosingReview, decideAll, SEASON, submitClosureAs } from "./closure-world.ts";
import { seasonResults } from "./season-results.query.ts";

const results = (world: ReviewWorld, day: number, who: "andrea" | "victor" = "andrea") =>
  seasonResults(world.at(day), who === "andrea" ? world.andrea : world.victor, {
    seasonId: SEASON,
  });

async function ok(world: ReviewWorld, day: number, who: "andrea" | "victor" = "andrea") {
  const result = await results(world, day, who);
  if (!result.ok) throw new Error(`results: ${result.error.kind}`);
  return result.value;
}

/** Victor logs three sessions of week 1 (a quarter of his season: 250 points). */
async function victorLogsWeekOne(world: ReviewWorld) {
  for (const day of [1, 2, 3]) {
    const logged = await recordEntry(world.at(day), world.victor, {
      seasonId: SEASON,
      commitmentId: world.victorRun,
      forDate: dateOfDay(day),
      value: { kind: "done" },
      clientRequestId: `v-${day}`,
    });
    if (!logged.ok) throw new Error(`victor entry ${day}: ${logged.error.kind}`);
  }
}

describe("seasonResults (screen 36)", () => {
  it("SC-RS: totals and per-commitment figures match the member's own score", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    for (const day of [0, 1, 2, 3]) await logMinutes(world, "meditar", day);
    await logMinutes(world, "leer", 2, "120");
    await answerClosingReview(world, "andrea");

    const view = await ok(world, 30);
    const score = await memberScore(world.at(30), world.andrea, { seasonId: SEASON });
    if (!score.ok || score.value.kind !== "scored") throw new Error("score");

    expect(view).toMatchObject({
      seasonId: SEASON,
      status: "active",
      lengthWeeks: 4,
      actualStart: dateOfDay(1),
      lastDay: dateOfDay(28),
      closingReviewDone: true,
      closure: null,
    });
    expect(view.totals).toEqual({
      points: score.value.points,
      consistencyPercent: score.value.consistency,
      idealPercent: score.value.idealCompletion,
    });
    expect(view.commitments.map((c) => [c.commitmentId, c.habitName, c.icon])).toEqual([
      [world.meditar, "Meditar", "book"],
      [world.leer, "Leer", "book"],
    ]);
    expect(view.commitments.reduce((sum, c) => sum + c.points, 0)).toBeGreaterThan(0);
    expect(view.commitments.every((c) => c.stage === "new")).toBe(true);
  });

  it("SC-RS1: automaticity runs from the start to the closing review", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await answerClosingReview(world, "andrea");
    const view = await ok(world, 30);
    expect(view.commitments.map((c) => c.automaticity)).toEqual([
      { from: null, to: "4,0" },
      { from: null, to: "4,0" },
    ]);
  });

  it("SC-RS4: without the closing review the figures still read, but flag it and hold no end score", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    const view = await ok(world, 30);
    expect(view.closingReviewDone).toBe(false);
    expect(view.commitments.map((c) => c.automaticity)).toEqual([
      { from: null, to: null },
      { from: null, to: null },
    ]);
  });

  it("rank and the gap to the member just above", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await victorLogsWeekOne(world);
    const view = await ok(world, 30);
    expect(view.standings).toEqual({
      rank: 2,
      memberCount: 2,
      gap: { displayName: "Victor", points: 250 },
    });
    expect((await ok(world, 30, "victor")).standings).toMatchObject({ rank: 1, gap: null });
  });

  it("with everybody at zero there is no rank and no gap", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    expect((await ok(world, 30)).standings).toEqual({ rank: null, memberCount: 2, gap: null });
  });

  it("is refused before the results day, with the date", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    for (const day of [10, 28, 29]) {
      expect(await results(world, day)).toEqual({
        ok: false,
        error: { kind: "SeasonResultsNotYet", availableOn: dateOfDay(30) },
      });
    }
  });

  it("SC-RS3: a stranger, an unknown season and a member with no commitments", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4, andreaWithoutCommitments: true });
    expect(
      await seasonResults(world.at(30), { userId: userId("user-nobody") }, { seasonId: SEASON }),
    ).toEqual({ ok: false, error: { kind: "NotAMember" } });
    expect(
      await seasonResults(world.at(30), world.andrea, { seasonId: "nope" as typeof SEASON }),
    ).toEqual({ ok: false, error: { kind: "SeasonNotFound" } });
    expect(await results(world, 30)).toEqual({ ok: false, error: { kind: "NothingToClose" } });
  });

  it("a member only ever reads their own commitments and their own closure", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await answerClosingReview(world, "andrea");
    await answerClosingReview(world, "victor");
    await submitClosureAs(world, "andrea", 30, decideAll(world, "andrea", "pause"));

    const victor = await ok(world, 30, "victor");
    expect(victor.commitments.map((c) => c.commitmentId)).toEqual([world.victorRun]);
    expect(victor.closure).toBeNull();
    expect((await ok(world, 30)).closure?.decisions).toEqual(decideAll(world, "andrea", "pause"));
  });

  it("stays readable after the season closed, and shows a graduated habit's stage", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await answerClosingReview(world, "andrea");
    await answerClosingReview(world, "victor");
    await submitClosureAs(world, "andrea", 30, [
      { commitmentId: world.meditar, decision: "graduate" },
      { commitmentId: world.leer, decision: "continue" },
    ]);
    await submitClosureAs(world, "victor", 30);

    const view = await ok(world, 45);

    expect(view.status).toBe("closed");
    expect(view.commitments.map((c) => c.stage)).toEqual(["graduated", "new"]);
    expect(view.closure?.decidedAt).toEqual(world.at(30).clock.now());
  });

  it("REQ-RS7: reading writes nothing", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await answerClosingReview(world, "andrea");
    await ok(world, 31);
    expect(await world.app.uow.read((repos) => repos.seasons.get(SEASON))).toMatchObject({
      status: "active",
      version: 0,
    });
  });
});
