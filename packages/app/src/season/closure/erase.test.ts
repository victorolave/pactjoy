import { describe, expect, it } from "vitest";
import { memberId } from "../../circle/circle.ts";
import { circleFeed } from "../../feed/circle-feed.query.ts";
import { graduationKey, sessionKey } from "../../feed/feed-key.ts";
import { givenReviewWorld, logMinutes } from "../../review/review-fixtures.ts";
import { feedReactionId, habitId, seasonClosureId, seasonId } from "../../shared/ids.ts";
import { ok } from "../../shared/result.ts";
import { seasonClosureFixture } from "../../testing/builders.ts";
import { seedClosure } from "./closure-seed.ts";
import { dropSeasonClosures, eraseMemberClosures } from "./erase.ts";

async function givenGraduationAndReactions() {
  const world = await givenReviewWorld({ lengthWeeks: 4 });
  const deps = world.at(29);
  await logMinutes(world, "meditar", 0, "30");
  await seedClosure(
    world.app,
    seasonClosureFixture({
      id: seasonClosureId("andrea-closure"),
      seasonId: seasonId("season-1"),
      memberId: memberId("member-andrea"),
      decisions: [{ commitmentId: world.leer, decision: "graduate" }],
      decidedAt: deps.clock.now(),
    }),
  );
  await seedClosure(
    world.app,
    seasonClosureFixture({
      id: seasonClosureId("victor-closure"),
      seasonId: seasonId("season-1"),
      memberId: memberId("member-victor"),
      decisions: [{ commitmentId: world.victorRun, decision: "continue" }],
      decidedAt: deps.clock.now(),
    }),
  );
  const graduation = graduationKey(habitId("habit-leer"));
  const session = sessionKey(world.meditar, 1);
  for (const [id, itemKey] of [
    ["graduation-reaction", graduation],
    ["session-reaction", session],
  ] as const) {
    await world.app.feedReactions.save(
      {
        id: feedReactionId(id),
        seasonId: seasonId("season-1"),
        itemKey,
        memberId: memberId("member-victor"),
        emoji: "clap",
        reactedAt: deps.clock.now(),
        version: 0,
      },
      null,
    );
  }
  const season = await world.app.seasons.get(seasonId("season-1"));
  if (!season) throw new Error("fixture season missing");
  return { world, deps, season, graduation, session };
}

describe("account erasure of closure sources and graduation reactions", () => {
  it("removes the announcement and peer reaction while the peer feed still derives real activity", async () => {
    const { world, deps, season, graduation, session } = await givenGraduationAndReactions();
    const before = await circleFeed(deps, world.victor);
    if (!before.ok) throw new Error("fixture feed failed");
    expect(before.value.items.find((item) => item.key === graduation)?.kind).toBe("graduated");
    expect(await world.app.feedReactions.listBySeason(season.id)).toHaveLength(2);
    await world.app.uow.transaction(async (repos) => {
      await eraseMemberClosures(repos, [memberId("member-andrea")], [season]);
      expect(await repos.seasonClosures.getMine(season.id, memberId("member-andrea"))).toBeNull();
      return ok(undefined);
    });
    const after = await circleFeed(deps, world.victor);
    if (!after.ok) throw new Error("peer feed failed after erasure");
    expect(after.value.items.some((item) => item.key === graduation)).toBe(false);
    expect(after.value.items.find((item) => item.key === session)?.kind).toBe("completed");
    expect((await world.app.feedReactions.listBySeason(season.id)).map((r) => r.itemKey)).toEqual([
      session,
    ]);
    expect(
      await world.app.seasonClosures.getMine(season.id, memberId("member-victor")),
    ).not.toBeNull();
    // Retrying also removes any stale target reaction even though the source is already absent.
    await world.app.uow.transaction(async (repos) => {
      await eraseMemberClosures(repos, [memberId("member-andrea")], [season]);
      return ok(undefined);
    });
    expect((await world.app.feedReactions.listBySeason(season.id)).map((r) => r.itemKey)).toEqual([
      session,
    ]);
  });

  it("rolls back both closure removal and peer reactions if the caller aborts", async () => {
    const { world, season } = await givenGraduationAndReactions();
    await world.app.uow.transaction(async (repos) => {
      await eraseMemberClosures(repos, [memberId("member-andrea")], [season]);
      return { ok: false as const, error: "abort" };
    });
    expect(
      await world.app.seasonClosures.getMine(season.id, memberId("member-andrea")),
    ).not.toBeNull();
    expect(await world.app.feedReactions.listBySeason(season.id)).toHaveLength(2);
  });
});

describe("dropSeasonClosures (a fully erased circle)", () => {
  it("deletes every closure of the seasons whoever owns it and keeps other seasons", async () => {
    const { world, season } = await givenGraduationAndReactions();
    await seedClosure(
      world.app,
      seasonClosureFixture({
        id: seasonClosureId("other-season-closure"),
        seasonId: seasonId("season-other"),
        memberId: memberId("member-andrea"),
      }),
    );
    await world.app.uow.transaction(async (repos) => {
      await dropSeasonClosures(repos, [season.id]);
      return ok(undefined);
    });
    expect(await world.app.seasonClosures.getMine(season.id, memberId("member-andrea"))).toBeNull();
    expect(await world.app.seasonClosures.getMine(season.id, memberId("member-victor"))).toBeNull();
    expect(
      await world.app.seasonClosures.getMine(seasonId("season-other"), memberId("member-andrea")),
    ).not.toBeNull();
  });
});
