import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { leaveCircle } from "../circle/leave-circle.ts";
import { buildCommitment, commitmentId } from "../commitment/commitment.ts";
import { givenReviewWorld, type ReviewWorld } from "../review/review-fixtures.ts";
import { seedClosure } from "../season/closure/closure-seed.ts";
import type { Actor } from "../shared/actor.ts";
import { circleId, habitId, seasonId, userId } from "../shared/ids.ts";
import {
  circleFixture,
  habitFixture,
  memberFixture,
  seasonClosureFixture,
  seasonFixture,
} from "../testing/builders.ts";
import { localInstant, SEASON_START } from "../testing/entry-fixtures.ts";
import { WEEKLY_TOTAL } from "../testing/entry-measures.ts";
import { instant } from "../time/instant.ts";
import { circleFeed } from "./circle-feed.query.ts";
import { dateOf } from "./feed-fixtures.ts";

/**
 * A graduation is a fact of ONE season's closure, not of the habit (ADR-0018, F8): a habit belongs
 * to its owner and can be reused in another circle, where it may be graduated. Circle A must not
 * announce what happened at circle B, and must not show it with A's privacy.
 */
const DAY = 35;
const GRADUATED_AT = localInstant(dateOf(30), 15 * 3_600_000);
const CARLA: Actor = { userId: userId("user-carla") };

interface Privacy {
  /** Privacy of Andrea's "Leer" in circle A (season-1). */
  readonly inA: "visible" | "private";
  /** Privacy of the same habit in circle B (season-2). */
  readonly inB: "visible" | "private";
}

/**
 * Andrea works "Leer" in circle A, leaves it, joins circle B (Carla's), reuses the habit there and
 * graduates it at B's close. Circle A's newest started season still holds the old commitment.
 */
async function givenReusedHabit(privacy: Privacy): Promise<ReviewWorld> {
  const world = await givenReviewWorld({ lengthWeeks: 4, privateLeer: privacy.inA === "private" });
  await leaveCircle(world.at(5), world.andrea, { circleId: circleId("circle-1") });
  const andreaInB = memberFixture({
    id: memberId("member-andrea-b"),
    userId: world.andrea.userId,
    displayName: "Andrea",
  });
  const carla = memberFixture({
    id: memberId("member-carla"),
    userId: CARLA.userId,
    displayName: "Carla",
  });
  const leerInB = buildCommitment({
    id: commitmentId("commitment-leer-b"),
    memberId: andreaInB.id,
    habitId: habitId("habit-leer"),
    weightPercent: 100,
    privacy: privacy.inB,
    measure: WEEKLY_TOTAL,
  });
  await world.app.uow.transaction(async (repos) => {
    await repos.circles.save(
      circleFixture({ id: circleId("circle-2"), members: [andreaInB, carla] }),
      null,
    );
    await repos.seasons.save(
      seasonFixture({
        id: seasonId("season-2"),
        circleId: circleId("circle-2"),
        status: "closed",
        nominalStart: SEASON_START,
        actualStart: SEASON_START,
        lengthWeeks: 4,
        pactClosedAt: instant(1),
        commitments: [leerInB],
      }),
      null,
    );
    const habit = await repos.habits.get(habitId("habit-leer"));
    if (!habit) throw new Error("no habit");
    await repos.habits.save(
      { ...habit, graduatedAt: GRADUATED_AT, version: habit.version + 1 },
      habit.version,
    );
    return { ok: true as const, value: undefined };
  });
  await seedClosure(
    world.app,
    seasonClosureFixture({
      seasonId: seasonId("season-2"),
      memberId: andreaInB.id,
      decisions: [{ commitmentId: leerInB.id, decision: "graduate" }],
      decidedAt: GRADUATED_AT,
    }),
  );
  return world;
}

async function graduationsSeenBy(world: ReviewWorld, viewer: Actor) {
  const feed = await circleFeed(world.at(DAY), viewer, {});
  if (!feed.ok) throw new Error(`feed failed: ${feed.error.kind}`);
  return feed.value.items.filter((item) => item.kind === "graduated");
}

describe("the graduation of a reused habit stays in the circle that closed it (F8)", () => {
  it.each([
    ["visible", "visible"],
    ["visible", "private"],
    ["private", "visible"],
    ["private", "private"],
  ] as const)(
    "circle A (habit %s there, %s in B) shows no graduation of a habit graduated in B",
    async (inA, inB) => {
      const world = await givenReusedHabit({ inA, inB });
      expect(await graduationsSeenBy(world, world.victor)).toEqual([]);
    },
  );

  it("circle B shows the graduation by name when the commitment is visible there", async () => {
    const world = await givenReusedHabit({ inA: "private", inB: "visible" });
    expect(await graduationsSeenBy(world, CARLA)).toMatchObject([
      {
        kind: "graduated",
        key: "graduation:habit-leer",
        memberId: "member-andrea-b",
        subject: { kind: "habit", name: "Leer" },
        at: GRADUATED_AT,
      },
    ]);
  });

  it("circle B masks it with B's own privacy, whatever the habit was in A", async () => {
    const world = await givenReusedHabit({ inA: "visible", inB: "private" });
    const [item] = await graduationsSeenBy(world, CARLA);
    expect(item).toMatchObject({ kind: "graduated", subject: { kind: "private" } });
    expect(JSON.stringify(item)).not.toContain("Leer");
  });
});

describe("a graduation inside the same circle still appears", () => {
  it("shows Andrea's graduate decision of the feed season, from the closure's instant", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await seedClosure(
      world.app,
      seasonClosureFixture({
        seasonId: seasonId("season-1"),
        memberId: memberId("member-andrea"),
        decisions: [
          { commitmentId: world.leer, decision: "graduate" },
          { commitmentId: world.meditar, decision: "continue" },
        ],
        decidedAt: GRADUATED_AT,
      }),
    );
    await world.app.uow.transaction(async (repos) => {
      await repos.habits.save(
        habitFixture({
          id: habitId("habit-leer"),
          ownerId: world.andrea.userId,
          name: "Leer",
          graduatedAt: GRADUATED_AT,
          version: 1,
        }),
        0,
      );
      return { ok: true as const, value: undefined };
    });
    const items = await graduationsSeenBy(world, world.victor);
    expect(items).toMatchObject([
      { memberId: "member-andrea", subject: { kind: "habit", name: "Leer" }, at: GRADUATED_AT },
    ]);
    // Only the graduate decision becomes an item: "Meditar" was continued.
    expect(items).toHaveLength(1);
    expect(items[0]?.onDate).not.toBe(dateOf(0));
  });
});
