import { describe, expect, it } from "vitest";
import { givenReviewWorld, type ReviewWorld } from "../../review/review-fixtures.ts";
import { PER_DAY_REACH, WEEKLY_TOTAL } from "../../testing/entry-measures.ts";
import { instant } from "../../time/instant.ts";
import { carryOver } from "./carry-over.query.ts";
import {
  answerClosingReview,
  givenNextSeason,
  givenSeasonClosed,
  SEASON,
  submitClosureAs,
} from "./closure-world.ts";

const carry = (world: ReviewWorld, seasonId: typeof SEASON, who: "andrea" | "victor" = "andrea") =>
  carryOver(world.at(31), who === "andrea" ? world.andrea : world.victor, { seasonId });

async function items(
  world: ReviewWorld,
  seasonId: typeof SEASON,
  who: "andrea" | "victor" = "andrea",
) {
  const result = await carry(world, seasonId, who);
  if (!result.ok) throw new Error(`carry-over: ${result.error.kind}`);
  return result.value;
}

describe("carryOver (the defaults of the next season)", () => {
  it("SC-CO1/CO2/CO3: continue, adjust and pause come back with the previous measure, weight and privacy", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await givenSeasonClosed(world, [
      { commitmentId: world.meditar, decision: "continue" },
      { commitmentId: world.leer, decision: "pause" },
    ]);
    const next = await givenNextSeason(world);

    const view = await items(world, next);

    expect(view).toEqual({
      previousSeasonId: SEASON,
      items: [
        {
          habitId: "habit-meditar",
          decision: "continue",
          previous: { measure: PER_DAY_REACH, weightPercent: 60, privacy: "visible" },
        },
        {
          habitId: "habit-leer",
          decision: "pause",
          previous: { measure: WEEKLY_TOTAL, weightPercent: 40, privacy: "visible" },
        },
      ],
    });
  });

  it("REQ-CO3/CO7: it is a read: no commitment, approval or Pause comes out of it", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await givenSeasonClosed(world, [
      { commitmentId: world.meditar, decision: "pause" },
      { commitmentId: world.leer, decision: "adjust" },
    ]);
    const next = await givenNextSeason(world);
    const seasons = () =>
      world.app.uow.read((repos) => repos.seasons.listByCircle("circle-1" as never));
    const before = await seasons();

    await items(world, next);

    expect(await seasons()).toEqual(before);
    expect(before[0]?.commitments).toEqual([]);
  });

  it("SC-CO4: a graduate decision, and a habit that is graduated by now, are left out", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await givenSeasonClosed(world, [
      { commitmentId: world.meditar, decision: "graduate" },
      { commitmentId: world.leer, decision: "adjust" },
    ]);
    const next = await givenNextSeason(world);
    expect((await items(world, next)).items.map((i) => [i.habitId, i.decision])).toEqual([
      ["habit-leer", "adjust"],
    ]);

    const leer = await world.app.uow.read((repos) => repos.habits.get("habit-leer" as never));
    if (!leer) throw new Error("habit missing");
    await world.app.uow.transaction(async (repos) => {
      await repos.habits.save(
        { ...leer, graduatedAt: instant(9), version: leer.version + 1 },
        leer.version,
      );
      return { ok: true, value: undefined };
    });
    expect((await items(world, next)).items).toEqual([]);
  });

  it("SC-CO5: a laggard, cut off before closing, has no defaults", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await answerClosingReview(world, "andrea");
    expect((await submitClosureAs(world, "andrea", 30)).ok).toBe(true);
    const next = await givenNextSeason(world, 36);

    expect(await items(world, next, "victor")).toEqual({ previousSeasonId: SEASON, items: [] });
    expect((await items(world, next)).items).toHaveLength(2);
  });

  it("only the viewer's own decisions come back", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await givenSeasonClosed(world);
    const next = await givenNextSeason(world);
    expect((await items(world, next, "victor")).items.map((i) => i.habitId)).toEqual([
      "habit-victor",
    ]);
  });

  it("the circle's first season has no previous one", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await world.app.uow.transaction(async (repos) => {
      const season = await repos.seasons.get(SEASON);
      if (!season) throw new Error("season missing");
      await repos.seasons.save(
        { ...season, status: "pactOpen", version: season.version + 1 },
        season.version,
      );
      return { ok: true, value: undefined };
    });
    expect(await items(world, SEASON)).toEqual({ previousSeasonId: null, items: [] });
  });

  it("is only for a season whose pact is open", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    expect(await carry(world, SEASON)).toEqual({ ok: false, error: { kind: "PactNotOpen" } });
  });

  it("a stranger and an unknown season", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    expect(
      await carryOver(world.at(31), { userId: "user-nobody" as never }, { seasonId: SEASON }),
    ).toEqual({ ok: false, error: { kind: "NotAMember" } });
    expect(await carry(world, "nope" as typeof SEASON)).toEqual({
      ok: false,
      error: { kind: "SeasonNotFound" },
    });
  });
});
