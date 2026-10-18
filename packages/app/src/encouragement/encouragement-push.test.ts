import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { leaveCircle } from "../circle/leave-circle.ts";
import { dispatchNotifications } from "../notifications/dispatch-notifications.ts";
import { givenReviewWorld, logMinutes, type ReviewWorld } from "../review/review-fixtures.ts";
import { circleId, pushSubscriptionId, seasonId } from "../shared/ids.ts";
import { pushSubscriptionFixture } from "../testing/notification-fixtures.ts";
import { createRecordingPushSender } from "../testing/recording-push-sender.ts";
import { sendEncouragement } from "./send-encouragement.ts";

const SEASON = seasonId("season-1");
const ANDREA = memberId("member-andrea");
const CIRCLE = circleId("circle-1");
const HOUR_MS = 3_600_000;

/**
 * The encouragement push (ADR-0018 F17, ADR-0017): a send enqueues one `encouragementNudge` to its
 * recipient in the same transaction, with ids only, and the dispatcher drops it once either side
 * has left. Andrea had a hard week 1 (final from day 9); Victor sends.
 */
async function given(): Promise<ReviewWorld> {
  const world = await givenReviewWorld();
  await logMinutes(world, "meditar", 0);
  await logMinutes(world, "meditar", 1);
  return world;
}

const DAY = 9;

const send = (world: ReviewWorld) =>
  sendEncouragement(world.at(DAY), world.victor, {
    seasonId: SEASON,
    recipientId: ANDREA,
    week: 1,
    emoji: "raisedHands",
  });

async function sent(world: ReviewWorld) {
  const result = await send(world);
  if (!result.ok) throw new Error(`send failed: ${result.error.kind}`);
  const [encouragement] = await world.app.encouragements.listReceived(SEASON, ANDREA);
  if (!encouragement) throw new Error("no encouragement stored");
  return encouragement;
}

async function withAndreaDevice(world: ReviewWorld) {
  await world.app.pushSubscriptions.upsert(
    pushSubscriptionFixture({
      id: pushSubscriptionId("device-andrea"),
      userId: world.andrea.userId,
      endpoint: "https://push.example/device-andrea",
    }),
  );
  return createRecordingPushSender();
}

describe("sendEncouragement enqueues the encouragementNudge push", () => {
  it("one notice to the recipient, keyed by the encouragement, carrying ids only", async () => {
    const world = await given();
    const encouragement = await sent(world);
    const now = world.at(DAY).clock.now();

    const notices = world.app.notifications.all();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      dedupeKey: `encouragement:${encouragement.id}`,
      kind: "encouragementNudge",
      params: { seasonId: SEASON, encouragementId: encouragement.id },
      circleId: CIRCLE,
      seasonId: SEASON,
      recipientMemberId: ANDREA,
      recipientUserId: world.andrea.userId,
      notBefore: now,
      expiresAt: now + 24 * HOUR_MS,
      rolloversLeft: 0,
      state: "pending",
    });
    // Nothing tells the recipient why: no week, habit, consistency, sender name or emoji.
    expect(Object.keys(notices[0]?.params ?? {}).sort()).toEqual(["encouragementId", "seasonId"]);
    expect(JSON.stringify(notices[0]?.params)).not.toMatch(/week|Meditar|Victor|raisedHands/i);
  });

  it("a refused send enqueues nothing", async () => {
    const world = await given();
    await sent(world);
    const again = await send(world);
    expect(again).toEqual({ ok: false, error: { kind: "EncouragementAlreadySent" } });
    expect(world.app.notifications.all()).toHaveLength(1);
  });

  it("a send before the week is final enqueues nothing", async () => {
    const world = await given();
    const early = await sendEncouragement(world.at(DAY - 1), world.victor, {
      seasonId: SEASON,
      recipientId: ANDREA,
      week: 1,
      emoji: "raisedHands",
    });
    expect(early.ok).toBe(false);
    expect(world.app.notifications.all()).toEqual([]);
  });
});

describe("dispatching the encouragementNudge", () => {
  it("delivers `{v: 1, kind, params}` to the recipient's device", async () => {
    const world = await given();
    const encouragement = await sent(world);
    const push = await withAndreaDevice(world);

    await dispatchNotifications({ ...world.at(DAY), push }, {});

    expect(push.sent.map((s) => s.payload)).toEqual([
      {
        v: 1,
        kind: "encouragementNudge",
        params: { seasonId: SEASON, encouragementId: encouragement.id },
      },
    ]);
    expect(world.app.notifications.all()[0]).toMatchObject({ state: "sent", outcome: "delivered" });
  });

  it("drops it when the recipient left the circle", async () => {
    const world = await given();
    await sent(world);
    const push = await withAndreaDevice(world);
    await leaveCircle(world.at(DAY), world.andrea, { circleId: CIRCLE });

    await dispatchNotifications({ ...world.at(DAY), push }, {});

    expect(push.sent).toEqual([]);
    expect(world.app.notifications.all()[0]).toMatchObject({
      state: "dropped",
      outcome: "recipientLeft",
    });
  });

  it("drops it when the sender left the circle", async () => {
    const world = await given();
    await sent(world);
    const push = await withAndreaDevice(world);
    await leaveCircle(world.at(DAY), world.victor, { circleId: CIRCLE });

    await dispatchNotifications({ ...world.at(DAY), push }, {});

    expect(push.sent).toEqual([]);
    expect(world.app.notifications.all()[0]).toMatchObject({
      state: "dropped",
      outcome: "irrelevant",
    });
  });
});
