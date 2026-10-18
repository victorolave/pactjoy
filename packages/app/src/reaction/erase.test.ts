import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { feedReactionId, seasonId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { feedReactionFixture } from "../testing/builders.ts";
import { dropSeasonReactions } from "./erase.ts";

const SEASON = seasonId("season-1");
const OTHER_SEASON = seasonId("season-2");

async function seeded() {
  const app = createTestApp();
  await app.uow.transaction(async ({ feedReactions }) => {
    await feedReactions.save(
      feedReactionFixture({ id: feedReactionId("r-1"), seasonId: SEASON }),
      null,
    );
    await feedReactions.save(
      feedReactionFixture({
        id: feedReactionId("r-2"),
        seasonId: SEASON,
        memberId: memberId("member-andrea"),
      }),
      null,
    );
    await feedReactions.save(
      feedReactionFixture({ id: feedReactionId("r-3"), seasonId: OTHER_SEASON }),
      null,
    );
    return ok(undefined);
  });
  return app;
}

describe("dropSeasonReactions", () => {
  it("deletes every reaction of the seasons and keeps other seasons", async () => {
    const app = await seeded();
    await app.uow.transaction(async (repos) => {
      await dropSeasonReactions(repos, [SEASON]);
      return ok(undefined);
    });
    expect(await app.feedReactions.listBySeason(SEASON)).toEqual([]);
    expect((await app.feedReactions.listBySeason(OTHER_SEASON)).map((r) => r.id)).toEqual([
      feedReactionId("r-3"),
    ]);
  });

  it("is undone when the transaction rolls back", async () => {
    const app = await seeded();
    await expect(
      app.uow.transaction(async (repos) => {
        await dropSeasonReactions(repos, [SEASON, OTHER_SEASON]);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await app.feedReactions.listBySeason(SEASON)).toHaveLength(2);
    expect(await app.feedReactions.listBySeason(OTHER_SEASON)).toHaveLength(1);
  });
});
