import type { MemberId } from "@pactjoy/engine";
import { eraseMember } from "../circle/erase-member.ts";
import { buildCommitment, commitmentId } from "../commitment/commitment.ts";
import { seedEncouragement } from "../encouragement/encouragement-seed.ts";
import type { EntryRecord } from "../entry/entry.ts";
import { recordEntry } from "../entry/record-entry.ts";
import { type ReservedPhoto, reservePhoto, uploadedPhoto } from "../entry-photo/photo-fixtures.ts";
import { sessionKey } from "../feed/feed-key.ts";
import { seedNotifications } from "../notifications/notification-seed.ts";
import type { PauseRequestRecord } from "../pause/pause-request.ts";
import { requestPause } from "../pause/request-pause.ts";
import { seedReminder } from "../reminders/reminder-seed.ts";
import { seedReview } from "../review/review-seed.ts";
import { seedClosure } from "../season/closure/closure-seed.ts";
import type { Season } from "../season/season.ts";
import {
  circleId,
  encouragementId,
  feedReactionId,
  habitId,
  pushSubscriptionId,
  reviewId,
  seasonClosureId,
  seasonId,
  userId,
} from "../shared/ids.ts";
import { createTestApp, type TestApp } from "../testing/app-harness.ts";
import {
  encouragementFixture,
  feedReactionFixture,
  nudgeDismissalFixture,
  reviewFixture,
  seasonClosureFixture,
  seasonFixture,
} from "../testing/builders.ts";
import { fixtureTimeZone, localInstant } from "../testing/entry-fixtures.ts";
import { dayOf, PER_DAY_REACH } from "../testing/entry-measures.ts";
import { outboxNoticeFixture, pushSubscriptionFixture } from "../testing/notification-fixtures.ts";
import { givenPauseWorld, type PauseWorld } from "../testing/pause-fixtures.ts";
import { localDate } from "../time/local-date.ts";

/** Day 5 of the fixture season, at noon: Andrea and Victor have each logged and asked for a Pause. */
export const ACCOUNT_NOW = localInstant(dayOf(5));
export const OLD_SEASON_ID = seasonId("season-0");

export interface AccountWorld extends PauseWorld {
  readonly app: TestApp;
  /** An earlier, closed season of the same circle, where Andrea and Victor both closed. */
  readonly oldSeason: Season;
  readonly andreaId: MemberId;
  readonly victorId: MemberId;
  readonly sofiaId: MemberId;
  readonly andreaEntry: EntryRecord;
  readonly victorEntry: EntryRecord;
  readonly andreaPause: PauseRequestRecord;
  readonly victorPause: PauseRequestRecord;
  /** Uploaded and attached to Andrea's entry. */
  readonly attachedPhoto: ReservedPhoto;
  /** Reserved by Andrea and never uploaded. */
  readonly pendingPhoto: ReservedPhoto;
}

/**
 * GIVEN, for the read-model tests: the state erasing Andrea leaves behind, written straight to the
 * stores. Her membership is a tombstone (left, no name), her commitments are private in every
 * season and her habits are gone. Nothing else changes: her pending Pause request stays pending.
 */
export async function givenAndreaErased(world: AccountWorld): Promise<void> {
  await world.app.uow.transaction(async (repos) => {
    const circle = await repos.circles.get(world.circle.id);
    if (!circle) throw new Error("setup: the circle vanished");
    await repos.circles.save(
      {
        ...circle,
        members: circle.members.map((m) =>
          m.id === world.andreaId ? eraseMember(m, ACCOUNT_NOW, userId("erased-andrea")) : m,
        ),
        version: circle.version + 1,
      },
      circle.version,
    );
    for (const season of await repos.seasons.listByCircle(circle.id)) {
      await repos.seasons.save(
        {
          ...season,
          commitments: season.commitments.map((c) =>
            c.memberId === world.andreaId ? { ...c, privacy: "private" as const } : c,
          ),
          version: season.version + 1,
        },
        season.version,
      );
    }
    await repos.habits.deleteByOwner(world.andrea.userId);
    return { ok: true as const, value: undefined };
  });
}

/**
 * GIVEN: Andrea, Victor and Sofia in an active season (day 5) plus an older closed one, with one of
 * every kind of row each personal table can hold for Andrea AND for Victor, so a test can tell
 * what an erasure of Andrea removed from what it must leave to Victor.
 */
export async function givenAccountWorld(): Promise<AccountWorld> {
  const app = createTestApp({ now: ACCOUNT_NOW, timeZone: fixtureTimeZone });
  // Stored before the circle's current season so it is not the circle's latest one.
  const oldSeason = seasonFixture({
    id: OLD_SEASON_ID,
    circleId: circleId("circle-1"),
    status: "closed",
    nominalStart: localDate("2026-08-01"),
    actualStart: localDate("2026-08-01"),
    lengthWeeks: 4,
    commitments: [
      buildCommitment({
        id: commitmentId("old-andrea"),
        memberId: "member-andrea" as MemberId,
        habitId: habitId("habit-andrea"),
        weightPercent: 100,
        privacy: "visible",
        measure: PER_DAY_REACH,
      }),
      buildCommitment({
        id: commitmentId("old-victor"),
        memberId: "member-victor" as MemberId,
        habitId: habitId("habit-victor"),
        weightPercent: 100,
        privacy: "visible",
        measure: PER_DAY_REACH,
      }),
    ],
  });
  await app.uow.transaction(async (repos) => {
    await repos.seasons.save(oldSeason, null);
    return { ok: true as const, value: undefined };
  });
  const world = await givenPauseWorld(app, { withSofia: true });
  const [andrea, victor, sofia] = world.circle.members;
  if (!andrea || !victor || !sofia) throw new Error("setup: the circle needs three members");

  const attachedPhoto = await uploadedPhoto(app, world.andrea, world, world.andreaCommitment);
  const pendingPhoto = await reservePhoto(app, world.andrea, world, world.andreaCommitment);
  const log = (
    actor: PauseWorld["andrea"],
    commitment: PauseWorld["andreaCommitment"],
    note: string,
    photoId?: ReservedPhoto["photoId"],
  ) =>
    recordEntry(app, actor, {
      seasonId: world.season.id,
      commitmentId: commitment,
      forDate: dayOf(5),
      value:
        commitment === world.andreaCommitment
          ? { kind: "quantity", value: "30" }
          : { kind: "done" },
      note,
      photoId: photoId ?? null,
      clientRequestId: `req-${note}`,
    });
  const andreaEntry = await log(
    world.andrea,
    world.andreaCommitment,
    "SENTINEL-andrea",
    attachedPhoto.photoId,
  );
  const victorEntry = await log(world.victor, world.victorCommitment, "victor-note");
  const ask = (
    actor: PauseWorld["andrea"],
    commitment: PauseWorld["andreaCommitment"],
    note: string,
  ) =>
    requestPause(app, actor, {
      seasonId: world.season.id,
      scope: { kind: "commitment", commitmentId: commitment },
      reason: "health",
      note,
      startDate: dayOf(5),
      endDate: null,
    });
  const andreaPause = await ask(world.andrea, world.andreaCommitment, "SENTINEL-pause");
  const victorPause = await ask(world.victor, world.victorCommitment, "victor-pause");
  if (!andreaEntry.ok || !victorEntry.ok || !andreaPause.ok || !victorPause.ok) {
    const refusal = [andreaEntry, victorEntry, andreaPause, victorPause].find((r) => !r.ok);
    throw new Error(`setup: a use case refused: ${JSON.stringify(refusal)}`);
  }

  for (const [owner, commitment] of [
    [andrea.id, world.andreaCommitment],
    [victor.id, world.victorCommitment],
  ] as const) {
    await seedReminder(app, {
      seasonId: world.season.id,
      commitmentId: commitment,
      memberId: owner,
      enabled: true,
      minuteOfDay: 20 * 60,
      weekdays: [1, 3],
      updatedAt: ACCOUNT_NOW,
      version: 1,
    });
    await seedReview(
      app,
      reviewFixture({
        id: reviewId(`review-${owner}`),
        seasonId: world.season.id,
        memberId: owner,
      }),
    );
    await seedClosure(
      app,
      seasonClosureFixture({
        id: seasonClosureId(`closure-${owner}`),
        seasonId: OLD_SEASON_ID,
        memberId: owner,
      }),
    );
  }
  for (const [id, reactor, target] of [
    ["r-victor-on-andrea", victor.id, world.andreaCommitment],
    ["r-andrea-on-victor", andrea.id, world.victorCommitment],
  ] as const) {
    await app.feedReactions.save(
      feedReactionFixture({
        id: feedReactionId(id),
        seasonId: world.season.id,
        itemKey: sessionKey(target, 6),
        memberId: reactor,
      }),
      null,
    );
  }
  await seedEncouragement(app, {
    encouragement: encouragementFixture({
      id: encouragementId("e-andrea-to-victor"),
      seasonId: world.season.id,
      senderId: andrea.id,
      recipientId: victor.id,
    }),
    dismissal: nudgeDismissalFixture({
      seasonId: world.season.id,
      viewerId: andrea.id,
      targetId: victor.id,
    }),
  });
  await seedEncouragement(app, {
    encouragement: encouragementFixture({
      id: encouragementId("e-victor-to-andrea"),
      seasonId: world.season.id,
      senderId: victor.id,
      recipientId: andrea.id,
    }),
    dismissal: nudgeDismissalFixture({
      seasonId: world.season.id,
      viewerId: victor.id,
      targetId: andrea.id,
    }),
  });
  await seedEncouragement(app, {
    dismissal: nudgeDismissalFixture({
      seasonId: world.season.id,
      viewerId: victor.id,
      targetId: sofia.id,
    }),
  });
  await seedNotifications(app, {
    notices: [
      outboxNoticeFixture({
        dedupeKey: "to-andrea",
        recipientUserId: world.andrea.userId,
        recipientMemberId: andrea.id,
        circleId: world.circle.id,
      }),
      outboxNoticeFixture({
        dedupeKey: "to-victor",
        recipientUserId: world.victor.userId,
        recipientMemberId: victor.id,
        circleId: world.circle.id,
      }),
    ],
    devices: [
      pushSubscriptionFixture({
        id: pushSubscriptionId("device-andrea"),
        userId: world.andrea.userId,
        endpoint: "https://push.example/SENTINEL-andrea",
      }),
      pushSubscriptionFixture({
        id: pushSubscriptionId("device-victor"),
        userId: world.victor.userId,
        endpoint: "https://push.example/victor",
      }),
    ],
  });
  return {
    ...world,
    app,
    oldSeason,
    andreaId: andrea.id,
    victorId: victor.id,
    sofiaId: sofia.id,
    andreaEntry: andreaEntry.value.entry,
    victorEntry: victorEntry.value.entry,
    andreaPause: andreaPause.value,
    victorPause: victorPause.value,
    attachedPhoto,
    pendingPhoto,
  };
}
