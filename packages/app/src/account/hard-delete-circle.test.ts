import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { storedSocial } from "../encouragement/encouragement-seed.ts";
import { storedPhoto } from "../entry-photo/photo-seed.ts";
import { seedNotifications } from "../notifications/notification-seed.ts";
import { storedPause } from "../pause/pause-seed.ts";
import { storedReminder } from "../reminders/reminder-seed.ts";
import { storedReviews } from "../review/review-seed.ts";
import { storedClosure } from "../season/closure/closure-seed.ts";
import { circleId, feedReactionId, seasonId, userId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import {
  circleFixture,
  feedReactionFixture,
  memberFixture,
  seasonFixture,
} from "../testing/builders.ts";
import { outboxNoticeFixture } from "../testing/notification-fixtures.ts";
import { givenAccountWorld, OLD_SEASON_ID } from "./account-world.ts";
import { hardDeleteCircle } from "./hard-delete-circle.ts";

async function hardDelete(
  world: Awaited<ReturnType<typeof givenAccountWorld>>,
  id = world.circle.id,
) {
  return world.app.uow.transaction(async (repos) => {
    const circle = await repos.circles.get(id);
    if (!circle) throw new Error("setup: circle vanished");
    return ok(await hardDeleteCircle(repos, circle));
  });
}

describe("hardDeleteCircle", () => {
  it("removes the circle and every row that hangs from its seasons, returning the photo rows", async () => {
    const world = await givenAccountWorld();
    const { app, season } = world;

    const result = await hardDelete(world);

    expect(result.ok && result.value.map((p) => p.id).sort()).toEqual(
      [world.attachedPhoto.photoId, world.pendingPhoto.photoId].sort(),
    );
    expect(await app.circles.get(world.circle.id)).toBeNull();
    expect(await app.seasons.listByCircle(world.circle.id)).toEqual([]);
    expect(await app.entries.get(world.andreaEntry.id)).toBeNull();
    expect(await app.entries.get(world.victorEntry.id)).toBeNull();
    expect(await storedPause(app, world.andreaPause.id)).toBeNull();
    expect(await storedPause(app, world.victorPause.id)).toBeNull();
    expect(await storedPhoto(app, world.attachedPhoto.photoId)).toBeNull();
    expect(await storedPhoto(app, world.pendingPhoto.photoId)).toBeNull();
    expect(await storedReviews(app, season.id, world.andreaId)).toEqual([]);
    expect(await storedReviews(app, season.id, world.victorId)).toEqual([]);
    expect(await storedClosure(app, OLD_SEASON_ID, world.andreaId)).toBeNull();
    expect(await storedClosure(app, OLD_SEASON_ID, world.victorId)).toBeNull();
    expect(await app.feedReactions.listBySeason(season.id)).toEqual([]);
    expect(await storedSocial(app, season.id, world.andreaId)).toEqual({
      received: [],
      sent: [],
      dismissed: [],
    });
    expect(await storedSocial(app, season.id, world.victorId)).toEqual({
      received: [],
      sent: [],
      dismissed: [],
    });
    expect(await storedReminder(app, season.id, world.andreaCommitment)).toBeNull();
    expect(await storedReminder(app, season.id, world.victorCommitment)).toBeNull();
    expect(app.notifications.all()).toEqual([]);
  });

  it("leaves another circle's tree and the people's devices alone", async () => {
    const world = await givenAccountWorld();
    const { app } = world;
    const other = circleFixture({
      id: circleId("circle-other"),
      members: [memberFixture({ id: memberId("member-zoe"), userId: userId("user-zoe") })],
    });
    const otherSeason = seasonFixture({ id: seasonId("season-other"), circleId: other.id });
    await app.uow.transaction(async (repos) => {
      await repos.circles.save(other, null);
      await repos.seasons.save(otherSeason, null);
      await repos.feedReactions.save(
        feedReactionFixture({
          id: feedReactionId("reaction-other"),
          seasonId: otherSeason.id,
          memberId: memberId("member-zoe"),
        }),
        null,
      );
      return ok(undefined);
    });
    await seedNotifications(app, {
      notices: [outboxNoticeFixture({ dedupeKey: "n-other", circleId: other.id })],
    });

    await hardDelete(world);

    expect(await app.circles.get(other.id)).toEqual(other);
    expect(await app.seasons.get(otherSeason.id)).toEqual(otherSeason);
    expect(await app.feedReactions.listBySeason(otherSeason.id)).toHaveLength(1);
    expect(app.notifications.all().map((n) => n.dedupeKey)).toEqual(["n-other"]);
    expect(app.pushSubscriptions.all()).toHaveLength(2);
  });

  it("deletes a circle that never had a season", async () => {
    const world = await givenAccountWorld();
    const empty = circleFixture({
      id: circleId("circle-empty"),
      members: [memberFixture({ id: memberId("member-zoe"), userId: userId("user-zoe") })],
    });
    await world.app.uow.transaction(async (repos) => {
      await repos.circles.save(empty, null);
      return ok(undefined);
    });

    const result = await hardDelete(world, empty.id);

    expect(result).toEqual(ok([]));
    expect(await world.app.circles.get(empty.id)).toBeNull();
    expect(await world.app.circles.get(world.circle.id)).not.toBeNull();
  });

  it("is undone when the transaction rolls back", async () => {
    const world = await givenAccountWorld();
    const { app } = world;
    await expect(
      app.uow.transaction(async (repos) => {
        await hardDeleteCircle(repos, world.circle);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await app.circles.get(world.circle.id)).toEqual(world.circle);
    expect(await app.entries.get(world.andreaEntry.id)).not.toBeNull();
    expect(await storedPhoto(app, world.attachedPhoto.photoId)).not.toBeNull();
    expect(await app.seasons.listByCircle(world.circle.id)).toHaveLength(2);
  });
});
