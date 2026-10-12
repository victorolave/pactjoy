import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { dateOfDay, givenReviewWorld, type ReviewWorld } from "../review/review-fixtures.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { circleId, habitId, seasonId } from "../shared/ids.ts";
import { raceTransactions } from "../testing/race-harness.ts";
import { givenClosures, storedClosure } from "./closure/closure-fixtures.ts";
import { createSeason } from "./create-season.ts";

const ANDREA = memberId("member-andrea");
const VICTOR = memberId("member-victor");
const CIRCLE = circleId("circle-1");

const closeAs = (world: ReviewWorld, member: typeof ANDREA) =>
  givenClosures(world.app, seasonId("season-1"), [member]);

/** Andrea starts a new 4-week season the day the clock reads (season day `n` of the old one). */
const startNext = (world: ReviewWorld, n: number) =>
  createSeason(world.at(n), world.andrea, {
    circleId: CIRCLE,
    timezone: "America/Santiago",
    startDate: dateOfDay(n),
    lengthWeeks: 4,
  });

const seasons = (world: ReviewWorld) =>
  world.app.uow.read((repos) => repos.seasons.listByCircle(CIRCLE));

describe("createSeason after an ended season (REQ-F6..F10)", () => {
  it("SC-F1/F7: everyone closed and the results day came: finalizes the old season and creates the new one in one go", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await closeAs(world, ANDREA);
    await closeAs(world, VICTOR);

    const result = await startNext(world, 30);

    expect(result.ok).toBe(true);
    const [latest, previous] = await seasons(world);
    expect(latest).toMatchObject({ status: "pactOpen" });
    expect(previous).toMatchObject({ id: "season-1", status: "closed", version: 1 });
  });

  it("not complete and not stale: SeasonInProgress, and nothing is written", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await closeAs(world, ANDREA);

    for (const n of [10, 28, 29, 30, 35]) {
      expect(await startNext(world, n)).toEqual({ ok: false, error: { kind: "SeasonInProgress" } });
    }
    const all = await seasons(world);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ status: "active", version: 0 });
  });

  it("everyone closed but the results day has not come (grace day): SeasonInProgress", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await closeAs(world, ANDREA);
    await closeAs(world, VICTOR);
    expect(await startNext(world, 29)).toEqual({ ok: false, error: { kind: "SeasonInProgress" } });
  });

  it("SC-F5: a week after the end, a laggard is cut off: no closure row, no graduation, habits stay available", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await closeAs(world, ANDREA);

    const result = await startNext(world, 36);

    expect(result.ok).toBe(true);
    const [latest, previous] = await seasons(world);
    expect(latest?.status).toBe("pactOpen");
    expect(previous?.status).toBe("closed");
    const closed = await storedClosure(world.app, seasonId("season-1"), VICTOR);
    const victorHabit = await world.app.uow.read((repos) =>
      repos.habits.get(habitId("habit-victor")),
    );
    expect(closed).toBeNull();
    expect(victorHabit?.graduatedAt).toBeNull();
  });

  it("a season that already closed still allows the next one (existing behaviour)", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await closeAs(world, ANDREA);
    await closeAs(world, VICTOR);
    expect((await startNext(world, 30)).ok).toBe(true);
    // The new season is pactOpen now: a second one is refused.
    expect(await startNext(world, 31)).toEqual({ ok: false, error: { kind: "SeasonInProgress" } });
  });

  it("REQ-F10: two racing createSeason calls: exactly one creates, the loser is a ConcurrencyConflict", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await closeAs(world, ANDREA);
    await closeAs(world, VICTOR);
    const attempt = (app: typeof world.app) =>
      createSeason(app, world.andrea, {
        circleId: CIRCLE,
        timezone: "America/Santiago",
        startDate: dateOfDay(30),
        lengthWeeks: 4,
      });

    const { winner, loser } = await raceTransactions(world.at(30), attempt, attempt);

    expect(winner.status).toBe("fulfilled");
    expect(loser.status).toBe("rejected");
    if (loser.status === "rejected") expect(loser.reason).toBeInstanceOf(ConcurrencyConflict);
    const all = await seasons(world);
    expect(all.filter((s) => s.status === "pactOpen")).toHaveLength(1);
    expect(all.filter((s) => s.id === "season-1")[0]?.version).toBe(1);
  });
});
