import { describe, expect, it } from "vitest";
import { memberId } from "../../circle/circle.ts";
import { givenReviewWorld, type ReviewWorld } from "../../review/review-fixtures.ts";
import { circleId, seasonClosureId, seasonId } from "../../shared/ids.ts";
import { ok } from "../../shared/result.ts";
import type { TestApp } from "../../testing/app-harness.ts";
import { seasonClosureFixture } from "../../testing/builders.ts";
import { finalizeIfReady, moveOnFor, participantsOf } from "./finalize.ts";
import { seasonCloseDay } from "./season-calendar.ts";

const ANDREA = memberId("member-andrea");
const VICTOR = memberId("member-victor");

async function closeAs(app: TestApp, member: typeof ANDREA) {
  await app.uow.transaction(async (repos) => {
    await repos.seasonClosures.save(
      seasonClosureFixture({
        id: seasonClosureId(`closure-${member}`),
        seasonId: seasonId("season-1"),
        memberId: member,
        decisions: [],
      }),
      null,
    );
    return ok(undefined);
  });
}

/** Runs `moveOnFor` for the latest season of the world at 1-based season day `n`. */
async function stateAt(world: ReviewWorld, n: number) {
  const app = world.at(n);
  return app.uow.read(async (repos) => {
    const circle = await repos.circles.findActiveByUser(world.andrea.userId);
    const season = await repos.seasons.findLatestByCircle(circleId("circle-1"));
    if (!circle || !season) throw new Error("fixture missing");
    return moveOnFor(repos, season, circle, seasonCloseDay(season, app.clock.now(), app.timeZone));
  });
}

describe("participantsOf", () => {
  it("is the active members with at least one commitment of the season", async () => {
    const world = await givenReviewWorld({ andreaWithoutCommitments: true });
    const { circle, season } = await world.app.uow.read(async (repos) => {
      const c = await repos.circles.findActiveByUser(world.andrea.userId);
      return { circle: c, season: await repos.seasons.findLatestByCircle(circleId("circle-1")) };
    });
    if (!circle || !season) throw new Error("fixture missing");
    expect(participantsOf(season, circle)).toEqual([VICTOR]);
    const left = {
      ...circle,
      members: circle.members.map((m) => (m.id === VICTOR ? { ...m, status: "left" as const } : m)),
    };
    expect(participantsOf(season, left)).toEqual([]);
  });
});

describe("moveOnFor", () => {
  it("is blocked before the results day even if everybody closed", async () => {
    const world = await givenReviewWorld();
    await closeAs(world.app, ANDREA);
    await closeAs(world.app, VICTOR);
    expect((await stateAt(world, 29)).kind).toBe("blocked");
  });

  it("is blocked with one participant still to close, complete when both did", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await closeAs(world.app, ANDREA);
    expect((await stateAt(world, 30)).kind).toBe("blocked");
    await closeAs(world.app, VICTOR);
    expect((await stateAt(world, 30)).kind).toBe("complete");
  });

  it("is stale a week after the end for a laggard", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await closeAs(world.app, ANDREA);
    expect((await stateAt(world, 35)).kind).toBe("blocked");
    expect((await stateAt(world, 36)).kind).toBe("stale");
  });

  it("a member with no commitments does not need to close", async () => {
    const world = await givenReviewWorld({ andreaWithoutCommitments: true, lengthWeeks: 4 });
    await closeAs(world.app, VICTOR);
    expect((await stateAt(world, 30)).kind).toBe("complete");
  });
});

describe("finalizeIfReady", () => {
  async function run(world: ReviewWorld, n: number, accept: "complete" | "completeOrStale") {
    const app = world.at(n);
    return app.uow.transaction(async (repos) => {
      const circle = await repos.circles.findActiveByUser(world.andrea.userId);
      const season = await repos.seasons.findLatestByCircle(circleId("circle-1"));
      if (!circle || !season) throw new Error("fixture missing");
      const day = seasonCloseDay(season, app.clock.now(), app.timeZone);
      return ok(await finalizeIfReady(repos, season, circle, day, accept));
    });
  }
  const stored = (world: ReviewWorld) =>
    world.app.uow.read((repos) => repos.seasons.findLatestByCircle(circleId("circle-1")));

  it("writes closed (version + 1) when complete", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await closeAs(world.app, ANDREA);
    await closeAs(world.app, VICTOR);
    const result = await run(world, 30, "complete");
    if (!result.ok) throw new Error("unexpected");
    expect(result.value.finalized).toBe(true);
    expect(await stored(world)).toMatchObject({ status: "closed", version: 1 });
  });

  it("does not finalize while someone is still to close", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await closeAs(world.app, ANDREA);
    const result = await run(world, 30, "complete");
    if (!result.ok) throw new Error("unexpected");
    expect(result.value.finalized).toBe(false);
    expect(await stored(world)).toMatchObject({ status: "active", version: 0 });
  });

  it("'complete' never finalizes on stale; 'completeOrStale' does", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await closeAs(world.app, ANDREA);
    const cautious = await run(world, 36, "complete");
    if (!cautious.ok) throw new Error("unexpected");
    expect(cautious.value.finalized).toBe(false);
    expect((await stored(world))?.status).toBe("active");
    const open = await run(world, 36, "completeOrStale");
    if (!open.ok) throw new Error("unexpected");
    expect(open.value.finalized).toBe(true);
    expect((await stored(world))?.status).toBe("closed");
  });

  it("is a no-op on a season that is already closed", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await closeAs(world.app, ANDREA);
    await closeAs(world.app, VICTOR);
    await run(world, 30, "complete");
    const again = await run(world, 31, "completeOrStale");
    if (!again.ok) throw new Error("unexpected");
    expect(again.value.finalized).toBe(false);
    expect(await stored(world)).toMatchObject({ status: "closed", version: 1 });
  });
});
