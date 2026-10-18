import {
  buildCommitment,
  circleFeed,
  circleId,
  commitmentId,
  createIntlTimeZone,
  deleteAccount,
  deleteEntry,
  encouragementId,
  entryId,
  entryPhotoId,
  feedReactionId,
  habitId,
  instant,
  inviteCode,
  leaveCircle,
  localDate,
  type Measure,
  memberId,
  memberProgress,
  memberScore,
  myPauseRequests,
  ok,
  pauseRequestId,
  pushSubscriptionId,
  recordEntry,
  requestEntryPhotoUpload,
  requestPause,
  respondToPause,
  reviewId,
  seasonClosureId,
  seasonId,
  seasonProgress,
  standings,
  timeZoneId,
  userId,
} from "@pactjoy/app";
import {
  circleFixture,
  createInMemoryEvidenceStorage,
  createInMemoryIdentityAdmin,
  createSeededRandomSource,
  encouragementFixture,
  entryPhotoFixture,
  feedReactionFixture,
  habitFixture,
  memberFixture,
  nudgeDismissalFixture,
  outboxNoticeFixture,
  pauseRequestFixture,
  pushSubscriptionFixture,
  reviewFixture,
  seasonClosureFixture,
  seasonFixture,
} from "@pactjoy/app/testing";
import { fromInt, type Schedule, seasonDay, type Weekday } from "@pactjoy/engine";
import { afterAll, describe, expect, it } from "vitest";
import { createPostgresUnitOfWork } from "../src/index.ts";
import { connect, databaseUrl, type Sql, truncateAll } from "./db.ts";
import { ERASURE_COVERAGE, PERSON_COLUMN, SEEDED_TABLES } from "./erasure-coverage.ts";

/**
 * The sentinel of account deletion (ADR-0019): Andrea's account is deleted from a real Postgres that
 * holds a sentinel string in every column she can write to, and nothing of her may be left. The
 * per-column rules live in `erasure-coverage.ts`; this file proves them end to end, with the app's
 * `deleteAccount` over the pg unit of work, an in-memory object storage and an in-memory identity.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const DAY_MS = 86_400_000;
/** Day 0 of the active season is 2026-10-05; "today" is day 4, at noon UTC. */
const dayOf = (n: number) => localDate(`2026-10-${String(5 + n).padStart(2, "0")}`);
const noonOf = (n: number) => instant(Date.UTC(2026, 9, 5 + n, 12));
const NOW = noonOf(4);
const UTC = timeZoneId("UTC");

const ANDREA = userId(uuid(0xa001));
const VICTOR = userId(uuid(0xa002));
const CARLA = userId(uuid(0xa003));
const M = {
  andrea: memberId(uuid(0x1001)),
  victor: memberId(uuid(0x1002)),
  andreaSolo: memberId(uuid(0x1003)),
  andreaPast: memberId(uuid(0x1004)),
  carla: memberId(uuid(0x1005)),
  victorOld: memberId(uuid(0x1006)),
};
const CIRCLE = {
  shared: circleId(uuid(0x2001)),
  solo: circleId(uuid(0x2002)),
  past: circleId(uuid(0x2003)),
};
const SEASON = {
  closed: seasonId(uuid(0x3001)),
  active: seasonId(uuid(0x3002)),
  solo: seasonId(uuid(0x3003)),
  past: seasonId(uuid(0x3004)),
};
const HABIT = {
  andrea: habitId(uuid(0x4001)),
  graduated: habitId(uuid(0x4002)),
  solo: habitId(uuid(0x4003)),
  victor: habitId(uuid(0x4004)),
  carla: habitId(uuid(0x4005)),
};
const C = {
  andrea: commitmentId(uuid(0x5001)),
  victor: commitmentId(uuid(0x5002)),
  andreaClosed: commitmentId(uuid(0x5003)),
  victorClosed: commitmentId(uuid(0x5004)),
  andreaSolo: commitmentId(uuid(0x5005)),
  andreaPast: commitmentId(uuid(0x5006)),
  carla: commitmentId(uuid(0x5007)),
};

const EVERY_DAY: Schedule = {
  period: "perSession",
  frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] satisfies Weekday[] },
};
const minutes = (unit: "minutes" | "custom", customLabel: string | null): Measure => ({
  unit,
  customLabel,
  precision: "decimal",
  target: { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) },
  schedule: EVERY_DAY,
});
const commitment = (
  id: typeof C.andrea,
  member: typeof M.andrea,
  habit: typeof HABIT.andrea,
  measure: Measure,
) =>
  buildCommitment({
    id,
    memberId: member,
    habitId: habit,
    weightPercent: 100,
    privacy: "visible",
    measure,
  });

/** A mutable clock the whole world shares, so the fake storage expires on the same time as the use cases. */
function createWorldClock() {
  let current = NOW;
  return {
    now: () => current,
    set: (to: typeof NOW) => {
      current = to;
    },
  };
}

function createWorld() {
  const clock = createWorldClock();
  let next = 0x900000;
  const ids = { next: () => uuid(next++) };
  const evidence = createInMemoryEvidenceStorage({ clock });
  const identity = createInMemoryIdentityAdmin();
  const uow = createPostgresUnitOfWork({ url: databaseUrl(), max: 4 });
  const deps = {
    uow,
    clock,
    ids,
    timeZone: createIntlTimeZone(),
    random: createSeededRandomSource(7),
    evidence,
    identity,
  };
  return { ...deps, deps };
}
type World = ReturnType<typeof createWorld>;

const must = <T, E>(result: { ok: true; value: T } | { ok: false; error: E }): T => {
  if (!result.ok) throw new Error(`setup: a use case refused: ${JSON.stringify(result.error)}`);
  return result.value;
};

const worlds: World[] = [];
const admin = connect(databaseUrl());
afterAll(async () => {
  await Promise.all(worlds.map((world) => world.uow.end()));
  await admin.end();
});
const newWorld = (): World => {
  const world = createWorld();
  worlds.push(world);
  return world;
};

const HEX = (n: number) => n.toString(16).padStart(32, "0");
const KEY = {
  andreaAttached: `o/${HEX(0xa1)}.jpg`,
  soloAttached: `o/${HEX(0xa2)}.jpg`,
  soloPending: `o/${HEX(0xa3)}.jpg`,
  pastAttached: `o/${HEX(0xa4)}.jpg`,
};
const JPEG = (() => {
  const bytes = new Uint8Array(1024);
  bytes.set([0xff, 0xd8, 0xff]);
  return bytes;
})();

/** Puts an object in the fake storage the way a browser would, without a use case. */
async function putObject(world: World, key: string): Promise<void> {
  const signed = await world.evidence.signUpload(
    key,
    { size: 1024, contentType: "image/jpeg" },
    600,
    NOW,
  );
  if (world.evidence.upload(signed, JPEG) !== "accepted") throw new Error("setup: upload refused");
}

/** Stores a photo through the use case and plays the browser: returns the id to attach. */
async function uploadedPhoto(
  world: World,
  actor: { userId: typeof ANDREA },
  season: typeof SEASON.active,
  commit: typeof C.andrea,
  upload: boolean,
) {
  const reserved = must(
    await requestEntryPhotoUpload(world.deps, actor, {
      seasonId: season,
      commitmentId: commit,
      byteSize: 2048,
      contentType: "image/jpeg",
    }),
  );
  if (upload) {
    const bytes = new Uint8Array(2048);
    bytes.set([0xff, 0xd8, 0xff]);
    if (world.evidence.upload(reserved.upload, bytes) !== "accepted")
      throw new Error("setup: upload refused");
  }
  return reserved.photoId;
}

/**
 * Andrea, with the sentinel in everything she can write, in four places: the circle she is active in
 * (with Victor), a closed season of it (a graduation Victor reacted to), a solo circle she left, and
 * a circle she left that Carla stays in. Victor and Carla own rows of every kind too, which must
 * come out untouched.
 */
async function seedShared(world: World): Promise<void> {
  const { uow, clock } = world;
  const late = noonOf(0);
  await uow.transaction(async (repos) => {
    for (const habit of [
      habitFixture({
        id: HABIT.andrea,
        ownerId: ANDREA,
        name: "SENTINEL-habit",
        why: "SENTINEL-why",
        category: "SENTINEL-category",
        icon: "sentinel-icon",
      }),
      habitFixture({
        id: HABIT.graduated,
        ownerId: ANDREA,
        name: "SENTINEL-graduated",
        graduatedAt: noonOf(-30),
      }),
      habitFixture({ id: HABIT.solo, ownerId: ANDREA, name: "SENTINEL-solo-habit" }),
      habitFixture({ id: HABIT.victor, ownerId: VICTOR, name: "Leer", why: "victor-why" }),
      habitFixture({ id: HABIT.carla, ownerId: CARLA, name: "Correr" }),
    ]) {
      await repos.habits.save(habit, null);
    }

    await repos.circles.save(
      circleFixture({
        id: CIRCLE.shared,
        name: "Rio Runners",
        members: [
          memberFixture({ id: M.andrea, userId: ANDREA, displayName: "SENTINEL-Andrea" }),
          memberFixture({ id: M.victor, userId: VICTOR, displayName: "Victor" }),
        ],
        invite: {
          code: inviteCode("SENT23"),
          createdAt: late,
          expiresAt: instant(late + 7 * DAY_MS),
          createdBy: M.andrea,
        },
      }),
      null,
    );
    await repos.circles.save(
      circleFixture({
        id: CIRCLE.solo,
        name: "Solo pasado",
        members: [
          memberFixture({
            id: M.andreaSolo,
            userId: ANDREA,
            displayName: "SENTINEL-solo-name",
            status: "left",
            leftAt: noonOf(-10),
          }),
        ],
        invite: {
          code: inviteCode("SOLO23"),
          createdAt: noonOf(-40),
          expiresAt: noonOf(-33),
          createdBy: M.andreaSolo,
        },
        archivedAt: noonOf(-10),
      }),
      null,
    );
    await repos.circles.save(
      circleFixture({
        id: CIRCLE.past,
        name: "Con Carla",
        members: [
          memberFixture({
            id: M.andreaPast,
            userId: ANDREA,
            displayName: "SENTINEL-past-name",
            status: "left",
            leftAt: noonOf(-2),
          }),
          memberFixture({ id: M.carla, userId: CARLA, displayName: "Carla" }),
        ],
      }),
      null,
    );

    // The closed season where Andrea graduated a habit and Victor reacted.
    await repos.seasons.save(
      seasonFixture({
        id: SEASON.closed,
        circleId: CIRCLE.shared,
        timeZone: UTC,
        nominalStart: localDate("2026-08-03"),
        actualStart: localDate("2026-08-03"),
        lengthWeeks: 4,
        status: "closed",
        commitments: [
          commitment(C.andreaClosed, M.andrea, HABIT.graduated, minutes("minutes", null)),
          commitment(C.victorClosed, M.victor, HABIT.victor, minutes("minutes", null)),
        ],
      }),
      null,
    );
    await repos.seasons.save(
      seasonFixture({
        id: SEASON.active,
        circleId: CIRCLE.shared,
        timeZone: UTC,
        nominalStart: dayOf(0),
        actualStart: dayOf(0),
        lengthWeeks: 4,
        status: "active",
        commitments: [
          commitment(C.andrea, M.andrea, HABIT.andrea, minutes("custom", "SENTINEL-cups")),
          commitment(C.victor, M.victor, HABIT.victor, minutes("minutes", null)),
        ],
        approvals: [
          { memberId: M.andrea, approvedAt: noonOf(-1) },
          { memberId: M.victor, approvedAt: noonOf(-1) },
        ],
        pactClosedAt: noonOf(-1),
      }),
      null,
    );
    await repos.seasons.save(
      seasonFixture({
        id: SEASON.solo,
        circleId: CIRCLE.solo,
        timeZone: UTC,
        nominalStart: localDate("2026-08-03"),
        actualStart: localDate("2026-08-03"),
        lengthWeeks: 4,
        status: "closed",
        commitments: [commitment(C.andreaSolo, M.andreaSolo, HABIT.solo, minutes("minutes", null))],
      }),
      null,
    );
    await repos.seasons.save(
      seasonFixture({
        id: SEASON.past,
        circleId: CIRCLE.past,
        timeZone: UTC,
        nominalStart: localDate("2026-09-28"),
        actualStart: localDate("2026-09-28"),
        lengthWeeks: 4,
        status: "active",
        commitments: [
          commitment(C.andreaPast, M.andreaPast, HABIT.graduated, minutes("minutes", null)),
          commitment(C.carla, M.carla, HABIT.carla, minutes("minutes", null)),
        ],
        approvals: [
          { memberId: M.andreaPast, approvedAt: noonOf(-8) },
          { memberId: M.carla, approvedAt: noonOf(-8) },
        ],
        pactClosedAt: noonOf(-8),
      }),
      null,
    );

    // Closures: Andrea graduated, Victor reacted to that graduation item.
    await repos.seasonClosures.save(
      seasonClosureFixture({
        id: seasonClosureId(uuid(0x6001)),
        seasonId: SEASON.closed,
        memberId: M.andrea,
        decisions: [{ commitmentId: C.andreaClosed, decision: "graduate" }],
        decidedAt: noonOf(-5),
      }),
      null,
    );
    await repos.seasonClosures.save(
      seasonClosureFixture({
        id: seasonClosureId(uuid(0x6002)),
        seasonId: SEASON.closed,
        memberId: M.victor,
        decisions: [{ commitmentId: C.victorClosed, decision: "continue" }],
        decidedAt: noonOf(-5),
      }),
      null,
    );
    await repos.seasonClosures.save(
      seasonClosureFixture({
        id: seasonClosureId(uuid(0x6003)),
        seasonId: SEASON.solo,
        memberId: M.andreaSolo,
        decisions: [{ commitmentId: C.andreaSolo, decision: "continue" }],
        decidedAt: noonOf(-11),
      }),
      null,
    );
    await repos.feedReactions.save(
      feedReactionFixture({
        id: feedReactionId(uuid(0x7001)),
        seasonId: SEASON.closed,
        itemKey: `graduation:${HABIT.graduated}`,
        memberId: M.victor,
        emoji: "fire",
      }),
      null,
    );
    await repos.feedReactions.save(
      feedReactionFixture({
        id: feedReactionId(uuid(0x7002)),
        seasonId: SEASON.active,
        itemKey: `session:${C.victor}:2`,
        memberId: M.andrea,
        emoji: "clap",
      }),
      null,
    );
    await repos.feedReactions.save(
      feedReactionFixture({
        id: feedReactionId(uuid(0x7003)),
        seasonId: SEASON.active,
        itemKey: `session:${C.andrea}:1`,
        memberId: M.victor,
        emoji: "heart",
      }),
      null,
    );
    await repos.feedReactions.save(
      feedReactionFixture({
        id: feedReactionId(uuid(0x7004)),
        seasonId: SEASON.solo,
        itemKey: `session:${C.andreaSolo}:1`,
        memberId: M.andreaSolo,
        emoji: "heart",
      }),
      null,
    );
    await repos.feedReactions.save(
      feedReactionFixture({
        id: feedReactionId(uuid(0x7005)),
        seasonId: SEASON.past,
        itemKey: `session:${C.carla}:1`,
        memberId: M.carla,
        emoji: "heart",
      }),
      null,
    );

    // Reviews: private reflections and SRBAI answers.
    const review = (
      n: number,
      season: typeof SEASON.active,
      member: typeof M.andrea,
      commit: typeof C.andrea,
      helped: string,
    ) =>
      reviewFixture({
        id: reviewId(uuid(0x8000 + n)),
        seasonId: season,
        memberId: member,
        periodIndex: 1,
        kind: "interim",
        status: "completed",
        srbai: "full",
        reflection: { helped, hard: `${helped}-hard` },
        responses: [{ commitmentId: commit, items: [5, 4, 3, 2] }],
        recordedAt: noonOf(-1),
      });
    await repos.reviews.save(review(1, SEASON.active, M.andrea, C.andrea, "SENTINEL-helped"), null);
    await repos.reviews.save(review(2, SEASON.active, M.victor, C.victor, "victor-helped"), null);
    await repos.reviews.save(
      review(3, SEASON.solo, M.andreaSolo, C.andreaSolo, "SENTINEL-solo-helped"),
      null,
    );
    await repos.reviews.save(review(4, SEASON.past, M.carla, C.carla, "carla-helped"), null);

    // Reminders.
    const reminder = (
      season: typeof SEASON.active,
      commit: typeof C.andrea,
      member: typeof M.andrea,
    ) => ({
      seasonId: season,
      commitmentId: commit,
      memberId: member,
      enabled: true,
      minuteOfDay: 20 * 60,
      weekdays: [1, 3] as Weekday[],
      updatedAt: noonOf(0),
      version: 1,
    });
    await repos.reminders.save(reminder(SEASON.active, C.andrea, M.andrea), null);
    await repos.reminders.save(reminder(SEASON.active, C.victor, M.victor), null);
    await repos.reminders.save(reminder(SEASON.solo, C.andreaSolo, M.andreaSolo), null);
    await repos.reminders.save(reminder(SEASON.past, C.carla, M.carla), null);

    // Encouragements and dismissals, both ways.
    await repos.encouragements.add(
      encouragementFixture({
        id: encouragementId(uuid(0x9001)),
        seasonId: SEASON.active,
        senderId: M.andrea,
        recipientId: M.victor,
        caseWeek: 1,
        sentAt: noonOf(1),
        sentOn: dayOf(1),
      }),
    );
    await repos.encouragements.add(
      encouragementFixture({
        id: encouragementId(uuid(0x9002)),
        seasonId: SEASON.active,
        senderId: M.victor,
        recipientId: M.andrea,
        caseWeek: 1,
        sentAt: noonOf(2),
        sentOn: dayOf(2),
      }),
    );
    await repos.nudgeDismissals.add(
      nudgeDismissalFixture({
        seasonId: SEASON.active,
        viewerId: M.andrea,
        targetId: M.victor,
        caseWeek: 1,
        dismissedAt: noonOf(1),
        dismissedOn: dayOf(1),
      }),
    );
    await repos.nudgeDismissals.add(
      nudgeDismissalFixture({
        seasonId: SEASON.active,
        viewerId: M.victor,
        targetId: M.andrea,
        caseWeek: 1,
        dismissedAt: noonOf(2),
        dismissedOn: dayOf(2),
      }),
    );

    // Notices and devices.
    const notice = (
      key: string,
      member: typeof M.andrea,
      user: typeof ANDREA,
      circle: typeof CIRCLE.shared,
      season: typeof SEASON.active,
    ) =>
      outboxNoticeFixture({
        dedupeKey: key,
        params: { seasonId: season },
        circleId: circle,
        seasonId: season,
        recipientMemberId: member,
        recipientUserId: user,
        timeZone: UTC,
        notBefore: noonOf(4),
        expiresAt: noonOf(5),
        createdAt: noonOf(4),
      });
    await repos.notifications.enqueue([
      notice("to-andrea-pending", M.andrea, ANDREA, CIRCLE.shared, SEASON.active),
      notice("to-andrea-sent", M.andrea, ANDREA, CIRCLE.shared, SEASON.active),
      notice("to-andrea-failed", M.andrea, ANDREA, CIRCLE.shared, SEASON.active),
      notice("to-andrea-solo", M.andreaSolo, ANDREA, CIRCLE.solo, SEASON.solo),
      notice("to-victor", M.victor, VICTOR, CIRCLE.shared, SEASON.active),
      notice("to-carla", M.carla, CARLA, CIRCLE.past, SEASON.past),
    ]);
    await repos.pushSubscriptions.upsert(
      pushSubscriptionFixture({
        id: pushSubscriptionId(uuid(0xa101)),
        userId: ANDREA,
        endpoint: "https://web.push.apple.com/sentinel-andrea-1",
      }),
    );
    await repos.pushSubscriptions.upsert(
      pushSubscriptionFixture({
        id: pushSubscriptionId(uuid(0xa102)),
        userId: ANDREA,
        endpoint: "https://web.push.apple.com/sentinel-andrea-2",
      }),
    );
    await repos.pushSubscriptions.upsert(
      pushSubscriptionFixture({
        id: pushSubscriptionId(uuid(0xa103)),
        userId: VICTOR,
        endpoint: "https://web.push.apple.com/victor",
      }),
    );
    await repos.pushSubscriptions.upsert(
      pushSubscriptionFixture({
        id: pushSubscriptionId(uuid(0xa104)),
        userId: CARLA,
        endpoint: "https://web.push.apple.com/carla",
      }),
    );

    // The solo and past circles: entries (one tombstone), photos, pauses.
    const entry = (
      n: number,
      season: typeof SEASON.active,
      member: typeof M.andrea,
      commit: typeof C.andrea,
      day: number,
      note: string,
      extra: { photoId?: ReturnType<typeof entryPhotoId> } = {},
    ) => ({
      id: entryId(uuid(0xb000 + n)),
      seasonId: season,
      memberId: member,
      commitmentId: commit,
      day: seasonDay(day),
      recordedOn: seasonDay(day),
      recordedAt: noonOf(day),
      clientRequestId: `${member === M.carla ? "carla" : "SENTINEL"}-req-${n}`,
      editedAt: null,
      version: 0,
      requestFingerprint: JSON.stringify(["done", null, note]),
      value: { kind: "done" as const },
      note,
      photoId: extra.photoId ?? null,
      deleted: false as const,
    });
    await repos.entryPhotos.add(
      entryPhotoFixture({
        id: entryPhotoId(uuid(0xc001)),
        seasonId: SEASON.solo,
        memberId: M.andreaSolo,
        commitmentId: C.andreaSolo,
        objectKey: KEY.soloAttached,
        status: "attached",
      }),
    );
    await repos.entryPhotos.add(
      entryPhotoFixture({
        id: entryPhotoId(uuid(0xc002)),
        seasonId: SEASON.solo,
        memberId: M.andreaSolo,
        commitmentId: C.andreaSolo,
        objectKey: KEY.soloPending,
        status: "pending",
      }),
    );
    await repos.entryPhotos.add(
      entryPhotoFixture({
        id: entryPhotoId(uuid(0xc003)),
        seasonId: SEASON.past,
        memberId: M.andreaPast,
        commitmentId: C.andreaPast,
        objectKey: KEY.pastAttached,
        status: "attached",
      }),
    );
    await repos.entries.add(
      entry(1, SEASON.solo, M.andreaSolo, C.andreaSolo, 1, "SENTINEL-solo-note", {
        photoId: entryPhotoId(uuid(0xc001)),
      }),
    );
    await repos.entries.add(
      entry(2, SEASON.solo, M.andreaSolo, C.andreaSolo, 2, "SENTINEL-solo-deleted"),
    );
    await repos.entries.remove(entryId(uuid(0xb002)), 0);
    await repos.entries.add(
      entry(3, SEASON.past, M.andreaPast, C.andreaPast, 1, "SENTINEL-past-note", {
        photoId: entryPhotoId(uuid(0xc003)),
      }),
    );
    await repos.entries.add(entry(4, SEASON.past, M.carla, C.carla, 1, "carla-note"));
    await repos.pauses.save(
      pauseRequestFixture({
        id: pauseRequestId(uuid(0xd001)),
        seasonId: SEASON.solo,
        memberId: M.andreaSolo,
        reason: "health",
        note: "SENTINEL-solo-pause",
        requestedAt: noonOf(-20),
        requestedOn: seasonDay(3),
        startDay: seasonDay(4),
        end: { kind: "fixed", lastDay: seasonDay(5) },
        status: "approved",
        decidedAt: noonOf(-19),
        decidedOn: seasonDay(4),
        commitments: [{ commitmentId: C.andreaSolo, resumedOn: null, resumedAt: null }],
      }),
      null,
    );
    await repos.pauses.save(
      pauseRequestFixture({
        id: pauseRequestId(uuid(0xd002)),
        seasonId: SEASON.past,
        memberId: M.andreaPast,
        reason: "health",
        note: "SENTINEL-past-pause",
        requestedAt: noonOf(-6),
        requestedOn: seasonDay(3),
        startDay: seasonDay(4),
        end: { kind: "fixed", lastDay: seasonDay(5) },
        status: "approved",
        decidedAt: noonOf(-5),
        decidedOn: seasonDay(4),
        commitments: [{ commitmentId: C.andreaPast, resumedOn: null, resumedAt: null }],
        responses: [{ memberId: M.carla, response: "approve", respondedAt: noonOf(-5) }],
      }),
      null,
    );
    return ok(undefined);
  });
  await putObject(world, KEY.soloAttached);
  await putObject(world, KEY.soloPending);
  await putObject(world, KEY.pastAttached);

  // The active season, through the use cases, day by day (the free text goes through the real fingerprints).
  const { deps } = world;
  const andrea = { userId: ANDREA };
  const victor = { userId: VICTOR };
  const log = async (
    who: typeof andrea,
    commit: typeof C.andrea,
    day: number,
    value: string,
    note: string,
    photoId: Awaited<ReturnType<typeof uploadedPhoto>> | null,
    request: string,
  ) => {
    clock.set(noonOf(day));
    return must(
      await recordEntry(deps, who, {
        seasonId: SEASON.active,
        commitmentId: commit,
        forDate: dayOf(day),
        value: { kind: "quantity", value },
        note,
        photoId,
        clientRequestId: request,
      }),
    ).entry;
  };
  clock.set(noonOf(0));
  const attached = await uploadedPhoto(world, andrea, SEASON.active, C.andrea, true);
  await log(andrea, C.andrea, 0, "30", "SENTINEL-note-0", attached, "SENTINEL-req-a0");
  clock.set(noonOf(0));
  const victorPhoto = await uploadedPhoto(world, victor, SEASON.active, C.victor, true);
  await log(victor, C.victor, 0, "30", "victor-note-0", victorPhoto, "victor-req-0");
  await log(andrea, C.andrea, 1, "25", "SENTINEL-note-1", null, "SENTINEL-req-a1");
  await log(victor, C.victor, 1, "30", "victor-note-1", null, "victor-req-1");

  // An approved pause for day 2 (Victor approved it), then entries for the days around it.
  clock.set(noonOf(1));
  const approved = must(
    await requestPause(deps, andrea, {
      seasonId: SEASON.active,
      scope: { kind: "commitment", commitmentId: C.andrea },
      reason: "health",
      note: "SENTINEL-pause-approved",
      startDate: dayOf(2),
      endDate: dayOf(2),
    }),
  );
  clock.set(instant(noonOf(1) + 3_600_000));
  must(await respondToPause(deps, victor, { pauseRequestId: approved.id, decision: "approve" }));
  await log(victor, C.victor, 2, "30", "victor-note-2", null, "victor-req-2");
  const dead = await log(andrea, C.andrea, 3, "20", "SENTINEL-note-3", null, "SENTINEL-req-a3");
  await log(victor, C.victor, 3, "30", "victor-note-3", null, "victor-req-3");
  clock.set(noonOf(3));
  must(await deleteEntry(deps, andrea, { entryId: dead.id }));

  // A pending pause nobody has answered, and a photo Andrea reserved and never used.
  clock.set(noonOf(3));
  must(
    await requestPause(deps, andrea, {
      seasonId: SEASON.active,
      scope: { kind: "commitment", commitmentId: C.andrea },
      reason: "health",
      note: "SENTINEL-pause-pending",
      startDate: dayOf(4),
      endDate: dayOf(6),
    }),
  );
  await uploadedPhoto(world, andrea, SEASON.active, C.andrea, false);
  clock.set(NOW);
  await withStates();

  /** The outbox only enqueues pending rows: two of Andrea's get a final state, as the dispatcher would leave them. */
  async function withStates(): Promise<void> {
    await admin.unsafe(
      "update pactjoy.notification_outbox set state = 'sent', outcome = 'delivered', attempts = 1, finished_at = created_at where dedupe_key = 'to-andrea-sent'",
    );
    await admin.unsafe(
      "update pactjoy.notification_outbox set state = 'failed', outcome = 'exhausted', attempts = 3, finished_at = created_at where dedupe_key = 'to-andrea-failed'",
    );
  }
}

/** Every row of every table of the schema, as text, in a stable order. */
async function dump(sql: Sql): Promise<Record<string, string[]>> {
  const tables = await sql.unsafe<{ table_name: string }[]>(
    "select table_name from information_schema.tables where table_schema = 'pactjoy' and table_type = 'BASE TABLE' order by table_name",
  );
  const out: Record<string, string[]> = {};
  for (const { table_name } of tables) {
    const rows = await sql.unsafe<{ r: string }[]>(
      `select row_to_json(t)::text as r from pactjoy."${table_name}" t order by r`,
    );
    out[table_name] = rows.map((row) => row.r);
  }
  return out;
}

const nonEmpty = (snapshot: Record<string, string[]>): string[] =>
  Object.entries(snapshot)
    .filter(([, rows]) => rows.length > 0)
    .map(([table]) => table)
    .sort();

const rowsContaining = (snapshot: Record<string, string[]>, needle: string): string[] =>
  Object.entries(snapshot).flatMap(([table, rows]) =>
    rows
      .filter((row) => row.toLowerCase().includes(needle.toLowerCase()))
      .map((row) => `${table}: ${row}`),
  );

const CONFIRM = { confirmation: "ELIMINAR" };
const andrea = { userId: ANDREA };
const victor = { userId: VICTOR };

/** Andrea's storage keys, as the ledger holds them before anything is erased. */
async function keysOf(sql: Sql, members: readonly string[]): Promise<string[]> {
  const rows = await sql.unsafe<{ object_key: string }[]>(
    "select object_key from pactjoy.entry_photos where member_id = any($1::uuid[]) order by object_key",
    [members as string[]],
  );
  return rows.map((row) => row.object_key);
}

/** Everything Victor can read about the season, as he reads it. */
async function victorReads(world: World) {
  const { deps } = world;
  return {
    standings: await standings(deps, victor, { seasonId: SEASON.active }),
    progress: await seasonProgress(deps, victor, { seasonId: SEASON.active }),
    andreaProgress: await memberProgress(deps, victor, {
      seasonId: SEASON.active,
      memberId: M.andrea,
    }),
    andreaScore: await memberScore(deps, victor, { seasonId: SEASON.active, memberId: M.andrea }),
    victorScore: await memberScore(deps, victor, { seasonId: SEASON.active, memberId: M.victor }),
    pauses: await myPauseRequests(deps, victor),
  };
}

/**
 * What erasing Andrea changes in a peer's read model, compared with her leaving the ordinary way: her
 * name is blank and every commitment of hers is a hidden row (id, weight and points). Nothing else.
 */
function erasedAsPeersSeeIt<T>(value: T): T {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== "object") return node;
    const record = node as Record<string, unknown>;
    if (
      record.kind === "detail" &&
      (record.commitmentId === C.andrea || record.commitmentId === C.andreaClosed)
    ) {
      return {
        kind: "hidden",
        commitmentId: record.commitmentId,
        weightPercent: record.weightPercent,
        points: record.points,
      };
    }
    return Object.fromEntries(
      Object.entries(record).map(([key, child]) => [
        key,
        key === "displayName" && child === "SENTINEL-Andrea" ? "" : walk(child),
      ]),
    );
  };
  return walk(value) as T;
}

describe("account deletion on Postgres: Andrea (sentinel)", () => {
  it("seeds a row in every table, so a table that is not seeded cannot hide a leftover", async () => {
    const world = newWorld();
    await seedShared(world);

    expect(nonEmpty(await dump(admin))).toEqual([...SEEDED_TABLES].sort());
  });

  it("leaves nothing of her anywhere: no user id, no sentinel string, no object key, no solo circle", async () => {
    const world = newWorld();
    await seedShared(world);
    const before = await dump(admin);
    const herKeys = await keysOf(admin, [M.andrea, M.andreaSolo, M.andreaPast]);
    const victorKeys = await keysOf(admin, [M.victor]);
    expect(herKeys).toHaveLength(5);
    expect(victorKeys).toHaveLength(1);
    // Four of her objects exist (the fifth photo was reserved and never uploaded), and Victor's.
    expect(world.evidence.keys()).toHaveLength(5);
    expect(world.evidence.keys()).toEqual(expect.arrayContaining(victorKeys));
    const carlaBefore = [...rowsContaining(before, CARLA), ...rowsContaining(before, M.carla)];
    expect(carlaBefore.length).toBeGreaterThan(8);

    const result = await deleteAccount(world.deps, andrea, CONFIRM);

    expect(result).toEqual(ok(undefined));
    const after = await dump(admin);
    // (1) The dump of the whole schema.
    expect(rowsContaining(after, ANDREA)).toEqual([]);
    expect(rowsContaining(after, "SENTINEL-")).toEqual([]);
    for (const key of herKeys) expect(rowsContaining(after, key)).toEqual([]);
    // (3) The circles that are now entirely erased are gone from every table.
    for (const id of [CIRCLE.solo, SEASON.solo, M.andreaSolo, C.andreaSolo, HABIT.solo]) {
      expect(rowsContaining(after, id)).toEqual([]);
    }
    // (4) The storage keeps the objects of the people who are still here, and nothing of hers.
    expect([...world.evidence.keys()]).toEqual(victorKeys);
    // (5) The identity went last and once, by the ORIGINAL id.
    expect(world.identity.deleted).toEqual([ANDREA]);
    // What stays is the circle's: Carla's rows and Victor's are exactly as they were.
    const carlaAfter = [...rowsContaining(after, CARLA), ...rowsContaining(after, M.carla)];
    expect(carlaAfter.sort()).toEqual(carlaBefore.sort());
    expect(after.habits?.some((row) => row.includes(HABIT.victor))).toBe(true);
    expect(after.reviews?.some((row) => row.includes(M.victor))).toBe(true);
    expect(after.commitment_reminders?.some((row) => row.includes(M.victor))).toBe(true);
    expect(after.push_subscriptions?.some((row) => row.includes(VICTOR))).toBe(true);
    expect(after.notification_outbox?.some((row) => row.includes("to-victor"))).toBe(true);
  });

  it("follows the registry: no row is left that names her in a column ruled delete, and each anonymize rule holds", async () => {
    const world = newWorld();
    await seedShared(world);
    const hers = [ANDREA, M.andrea, M.andreaSolo, M.andreaPast];
    await deleteAccount(world.deps, andrea, CONFIRM);

    for (const [key, entry] of Object.entries(ERASURE_COVERAGE)) {
      const [table, column] = key.split(".") as [string, string];
      if (entry.rule !== "delete" || !PERSON_COLUMN.test(column)) continue;
      const [row] = await admin.unsafe<{ n: number }[]>(
        `select count(*)::int as n from pactjoy."${table}" where "${column}"::text = any($1)`,
        [hers],
      );
      expect(row?.n, key).toBe(0);
    }
    // A graduation disappears with its reactions, wherever they sit (owner decision, option A).
    const reactions = await admin.unsafe<{ item_key: string }[]>(
      "select item_key from pactjoy.feed_reactions where item_key like 'graduation:%'",
    );
    expect(reactions).toEqual([]);

    const members = await admin.unsafe(
      "select id, user_id, display_name, status, erased_at is not null as erased from pactjoy.circle_members where id = any($1) order by id",
      [[M.andrea, M.andreaSolo, M.andreaPast]],
    );
    expect(members).toEqual([
      expect.objectContaining({ id: M.andrea, display_name: "", status: "left", erased: true }),
      expect.objectContaining({ id: M.andreaPast, display_name: "", status: "left", erased: true }),
    ]);
    expect(members.every((m) => m.user_id !== ANDREA)).toBe(true);
    const entries = await admin.unsafe(
      "select note, photo_id, request_fingerprint, client_request_id = id::text as keyed, deleted, version from pactjoy.entries where member_id = any($1) order by id",
      [[M.andrea, M.andreaPast]],
    );
    expect(entries).toHaveLength(4);
    expect(entries.every((e) => e.note === null && e.photo_id === null)).toBe(true);
    expect(entries.every((e) => e.request_fingerprint === "erased" && e.keyed)).toBe(true);
    expect(entries.filter((e) => e.deleted)).toHaveLength(1);
    const pauses = await admin.unsafe(
      "select note, reason, status from pactjoy.pause_requests where member_id = any($1) order by id",
      [[M.andrea, M.andreaPast]],
    );
    expect(pauses).toHaveLength(3);
    expect(pauses.every((p) => p.note === null && p.reason === "other")).toBe(true);
    const commitments = await admin.unsafe(
      "select id, privacy, measure->'customLabel' as label from pactjoy.season_commitments where member_id = any($1) order by id",
      [[M.andrea, M.andreaPast]],
    );
    expect(commitments).toHaveLength(3);
    expect(commitments.every((c) => c.privacy === "private" && c.label === null)).toBe(true);
    // Victor's commitment was not hidden.
    const [victorRow] = await admin.unsafe(
      "select privacy from pactjoy.season_commitments where member_id = $1 and season_id = $2",
      [M.victor, SEASON.active],
    );
    expect(victorRow).toEqual({ privacy: "visible" });
  });

  it("changes nothing Victor reads except her name and her hidden commitments, compared with an ordinary leave", async () => {
    const left = newWorld();
    await seedShared(left);
    const leave = await leaveCircle(left.deps, andrea, { circleId: CIRCLE.shared });
    expect(leave.ok).toBe(true);
    const reference = await victorReads(left);
    await truncateAll(admin);

    const erased = newWorld();
    await seedShared(erased);
    expect(await deleteAccount(erased.deps, andrea, CONFIRM)).toEqual(ok(undefined));
    const actual = await victorReads(erased);

    // The reference is meaningful: she was a scored member, her points are not zero and her detail is visible.
    const referenceScore = reference.andreaScore;
    expect(
      referenceScore.ok && referenceScore.value.kind === "scored" && referenceScore.value.points,
    ).toBeGreaterThan(0);
    expect(JSON.stringify(reference.andreaProgress)).toContain("SENTINEL-cups");
    expect(JSON.stringify(actual)).not.toContain("SENTINEL");
    expect(actual).toEqual(erasedAsPeersSeeIt(reference));
    // The transform really changed something: without it the two would differ.
    expect(erasedAsPeersSeeIt(reference)).not.toEqual(reference);
    // Her pending Pause request is gone from the approvals Victor owes, as in any leave.
    expect(actual.pauses.awaitingMe).toEqual([]);
  });

  it("reads the circle feed for Victor without a graduation, a name or a free-text unit of hers", async () => {
    const world = newWorld();
    await seedShared(world);
    expect(await deleteAccount(world.deps, andrea, CONFIRM)).toEqual(ok(undefined));

    const feed = await circleFeed(world.deps, victor, {});

    expect(feed.ok).toBe(true);
    const text = JSON.stringify(feed).toLowerCase();
    expect(text).not.toContain("sentinel");
    expect(text).not.toContain("graduation:");
    expect(feed.ok && feed.value.members.find((member) => member.id === M.andrea)).toEqual({
      id: M.andrea,
      displayName: null,
      isYou: false,
      left: true,
    });
  });

  it("a second deletion succeeds, writes nothing and calls the identity again", async () => {
    const world = newWorld();
    await seedShared(world);
    expect(await deleteAccount(world.deps, andrea, CONFIRM)).toEqual(ok(undefined));
    const once = await dump(admin);

    expect(await deleteAccount(world.deps, andrea, CONFIRM)).toEqual(ok(undefined));

    expect(await dump(admin)).toEqual(once);
    expect(world.identity.deleted).toEqual([ANDREA, ANDREA]);
  });

  it("keeps the identity when the identity admin is down, and a retry only repeats that step", async () => {
    const world = newWorld();
    await seedShared(world);
    world.identity.setFailure("unavailable");

    expect(await deleteAccount(world.deps, andrea, CONFIRM)).toEqual({
      ok: false,
      error: { kind: "IdentityUnavailable" },
    });
    const erasedOnce = await dump(admin);
    expect(rowsContaining(erasedOnce, ANDREA)).toEqual([]);
    world.identity.setFailure(null);
    expect(await deleteAccount(world.deps, andrea, CONFIRM)).toEqual(ok(undefined));

    expect(await dump(admin)).toEqual(erasedOnce);
    expect(world.identity.deleted).toEqual([ANDREA]);
  });

  it("lets Victor carry on in the circle: he records an entry and leaves", async () => {
    const world = newWorld();
    await seedShared(world);
    expect(await deleteAccount(world.deps, andrea, CONFIRM)).toEqual(ok(undefined));

    const recorded = await recordEntry(world.deps, victor, {
      seasonId: SEASON.active,
      commitmentId: C.victor,
      forDate: dayOf(4),
      value: { kind: "quantity", value: "40" },
      note: "victor-note-4",
      clientRequestId: "victor-req-4",
    });
    const left = await leaveCircle(world.deps, victor, { circleId: CIRCLE.shared });

    expect(recorded.ok && recorded.value.entry.note).toBe("victor-note-4");
    expect(left.ok && left.value.members.map((m) => [m.id, m.status, m.erasedAt !== null])).toEqual(
      [
        [M.andrea, "left", true],
        [M.victor, "left", false],
      ],
    );
  });

  it("deletes the whole tree of the circle she was alone in, leaving the schema empty", async () => {
    const world = newWorld();
    await seedSoloActive(world);
    const before = await dump(admin);
    expect(nonEmpty(before).length).toBeGreaterThan(14);
    expect(world.evidence.keys()).toHaveLength(1);

    expect(await deleteAccount(world.deps, andrea, CONFIRM)).toEqual(ok(undefined));

    const after = await dump(admin);
    expect(nonEmpty(after)).toEqual([]);
    expect(world.evidence.keys()).toEqual([]);
    expect(world.identity.deleted).toEqual([ANDREA]);
  });
});

const SOLO = {
  circle: circleId(uuid(0x2004)),
  season: seasonId(uuid(0x3005)),
  member: memberId(uuid(0x1007)),
  commitment: commitmentId(uuid(0x5008)),
  habit: habitId(uuid(0x4006)),
};

/** Andrea alone and still active in a circle with a started season: leaving archives it, then it is deleted whole. */
async function seedSoloActive(world: World): Promise<void> {
  await world.uow.transaction(async (repos) => {
    await repos.habits.save(
      habitFixture({
        id: SOLO.habit,
        ownerId: ANDREA,
        name: "SENTINEL-alone",
        why: "SENTINEL-why",
      }),
      null,
    );
    await repos.circles.save(
      circleFixture({
        id: SOLO.circle,
        name: "Solo",
        members: [
          memberFixture({ id: SOLO.member, userId: ANDREA, displayName: "SENTINEL-alone" }),
        ],
        invite: {
          code: inviteCode("ALONE2"),
          createdAt: noonOf(0),
          expiresAt: instant(noonOf(0) + 7 * DAY_MS),
          createdBy: SOLO.member,
        },
      }),
      null,
    );
    await repos.seasons.save(
      seasonFixture({
        id: SOLO.season,
        circleId: SOLO.circle,
        timeZone: UTC,
        nominalStart: dayOf(0),
        actualStart: dayOf(0),
        lengthWeeks: 4,
        status: "active",
        commitments: [
          commitment(SOLO.commitment, SOLO.member, SOLO.habit, minutes("custom", "SENTINEL-cups")),
        ],
        approvals: [{ memberId: SOLO.member, approvedAt: noonOf(-1) }],
        pactClosedAt: noonOf(-1),
      }),
      null,
    );
    await repos.reviews.save(
      reviewFixture({
        id: reviewId(uuid(0x8100)),
        seasonId: SOLO.season,
        memberId: SOLO.member,
        periodIndex: 1,
        kind: "interim",
        status: "completed",
        srbai: "item1",
        reflection: { helped: "SENTINEL-helped", hard: null },
        responses: [{ commitmentId: SOLO.commitment, items: [6, null, null, null] }],
      }),
      null,
    );
    await repos.reminders.save(
      {
        seasonId: SOLO.season,
        commitmentId: SOLO.commitment,
        memberId: SOLO.member,
        enabled: true,
        minuteOfDay: 20 * 60,
        weekdays: [0, 1],
        updatedAt: noonOf(0),
        version: 1,
      },
      null,
    );
    await repos.feedReactions.save(
      feedReactionFixture({
        id: feedReactionId(uuid(0x8101)),
        seasonId: SOLO.season,
        itemKey: `session:${SOLO.commitment}:1`,
        memberId: SOLO.member,
      }),
      null,
    );
    await repos.notifications.enqueue([
      outboxNoticeFixture({
        dedupeKey: "to-andrea-alone",
        params: { seasonId: SOLO.season },
        circleId: SOLO.circle,
        seasonId: SOLO.season,
        recipientMemberId: SOLO.member,
        recipientUserId: ANDREA,
        timeZone: UTC,
        notBefore: NOW,
        expiresAt: noonOf(5),
        createdAt: NOW,
      }),
    ]);
    await repos.pushSubscriptions.upsert(
      pushSubscriptionFixture({
        id: pushSubscriptionId(uuid(0x8102)),
        userId: ANDREA,
        endpoint: "https://web.push.apple.com/sentinel-alone",
      }),
    );
    return ok(undefined);
  });
  const { deps, clock } = world;
  clock.set(noonOf(1));
  const photo = await uploadedPhoto(world, andrea, SOLO.season, SOLO.commitment, true);
  must(
    await recordEntry(deps, andrea, {
      seasonId: SOLO.season,
      commitmentId: SOLO.commitment,
      forDate: dayOf(1),
      value: { kind: "quantity", value: "30" },
      note: "SENTINEL-alone-note",
      photoId: photo,
      clientRequestId: "SENTINEL-alone-req",
    }),
  );
  clock.set(noonOf(2));
  must(
    await requestPause(deps, andrea, {
      seasonId: SOLO.season,
      scope: { kind: "commitment", commitmentId: SOLO.commitment },
      reason: "health",
      note: "SENTINEL-alone-pause",
      startDate: dayOf(3),
      endDate: dayOf(3),
    }),
  );
  clock.set(NOW);
}
