import { describe, expect, it } from "vitest";
import { approvePact } from "../pact/approve-pact.ts";
import { cancelPauseRequest } from "../pause/cancel-pause-request.ts";
import { requestPause } from "../pause/request-pause.ts";
import { pushSubscriptionId } from "../shared/ids.ts";
import { createTestApp, type TestApp } from "../testing/app-harness.ts";
import { atInstant, fixtureTimeZone, localInstant } from "../testing/entry-fixtures.ts";
import { dayOf } from "../testing/entry-measures.ts";
import { outboxNoticeFixture, pushSubscriptionFixture } from "../testing/notification-fixtures.ts";
import { givenPauseWorld, type PauseWorld } from "../testing/pause-fixtures.ts";
import { createRecordingPushSender } from "../testing/recording-push-sender.ts";
import { type Instant, instant } from "../time/instant.ts";
import { localDate } from "../time/local-date.ts";
import { dispatchNotifications } from "./dispatch-notifications.ts";
import type { OutboxNotice } from "./outbox-notice.ts";

/**
 * The dispatcher (ADR-0017, design J8/J13): claims due rows with a lease, re-checks them, sends to
 * every device of the recipient OUTSIDE any transaction, and records the outcome fenced by the
 * claim. The fixture zone is UTC-3; quiet hours are 22:00-08:00 there.
 */

const MIN = 60_000;
const at = (date: string, hour: number, minute = 0) =>
  localInstant(localDate(date), (hour * 60 + minute) * MIN);
const NOON = at("2026-10-06", 12);

async function given() {
  const app = createTestApp({ now: NOON, timeZone: fixtureTimeZone });
  const world = await givenPauseWorld(app, { withSofia: true });
  const push = createRecordingPushSender();
  return { app, world, push };
}

const device = (world: PauseWorld, n: number, member: "victor" | "andrea" = "victor") =>
  pushSubscriptionFixture({
    id: pushSubscriptionId(`device-${n}`),
    userId: world[member].userId,
    endpoint: `https://push.example/device-${n}`,
  });

/** A pending `seasonStarted` to Victor, due from `notBefore`. */
const noticeFor = (world: PauseWorld, extra: Partial<OutboxNotice> = {}): OutboxNotice =>
  outboxNoticeFixture({
    dedupeKey: "seasonStarted:season-1:member-victor",
    kind: "seasonStarted",
    params: { seasonId: world.season.id },
    circleId: world.circle.id,
    seasonId: world.season.id,
    recipientMemberId: "member-victor" as OutboxNotice["recipientMemberId"],
    recipientUserId: world.victor.userId,
    notBefore: NOON,
    expiresAt: at("2026-10-06", 22),
    createdAt: NOON,
    ...extra,
  } as Partial<OutboxNotice>);

async function seed(app: TestApp, notices: OutboxNotice[], devices: ReturnType<typeof device>[]) {
  await app.notifications.enqueue(notices);
  for (const d of devices) await app.pushSubscriptions.upsert(d);
}

const dispatch = (
  app: TestApp,
  push: ReturnType<typeof createRecordingPushSender> | null,
  now: Instant,
) => dispatchNotifications({ ...atInstant(app, now), push }, {});

const only = (app: TestApp) => {
  const [row] = app.notifications.all();
  if (!row) throw new Error("no row");
  return row;
};

describe("dispatchNotifications: delivery", () => {
  it("sends `{v, kind, params}` to the recipient's device and records it sent", async () => {
    const { app, world, push } = await given();
    await seed(app, [noticeFor(world)], [device(world, 1)]);

    const result = await dispatch(app, push, NOON);

    expect(result).toEqual({
      ok: true,
      value: { claimed: 1, sent: 1, dropped: 0, retried: 0, failed: 0, deferred: 0 },
    });
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]?.payload).toEqual({
      v: 1,
      kind: "seasonStarted",
      params: { seasonId: world.season.id },
    });
    expect(push.sent[0]?.message).toMatchObject({
      urgency: "normal",
      collapseKey: "seasonStarted:season-1:member-victor",
      ttlSeconds: 10 * 3600,
    });
    expect(only(app)).toMatchObject({ state: "sent", outcome: "delivered", finishedAt: NOON });
  });

  it("SC-W4: without a push sender nothing is claimed and the rows stay as they are", async () => {
    const { app, world } = await given();
    await seed(app, [noticeFor(world)], [device(world, 1)]);
    expect(await dispatch(app, null, NOON)).toEqual({
      ok: true,
      value: { claimed: 0, sent: 0, dropped: 0, retried: 0, failed: 0, deferred: 0 },
    });
    expect(only(app)).toMatchObject({ state: "pending", attempts: 0 });
  });

  it("REQ-O10: a recipient with no device drops the notice (no retry, no later replay)", async () => {
    const { app, world, push } = await given();
    await seed(app, [noticeFor(world)], []);
    await dispatch(app, push, NOON);
    expect(only(app)).toMatchObject({ state: "dropped", outcome: "noSubscription" });
    await app.pushSubscriptions.upsert(device(world, 1));
    await dispatch(app, push, at("2026-10-06", 13));
    expect(push.sent).toEqual([]);
  });

  it("SC-O5: a 410 deletes that device; another device still gets the notice", async () => {
    const { app, world, push } = await given();
    await seed(app, [noticeFor(world)], [device(world, 1), device(world, 2)]);
    push.respondWith((target) =>
      target.endpoint.endsWith("device-2") ? { kind: "gone" } : { kind: "delivered" },
    );
    await dispatch(app, push, NOON);
    expect(only(app)).toMatchObject({ state: "sent" });
    expect(app.pushSubscriptions.all().map((d) => d.id)).toEqual(["device-1"]);
  });

  it("every device gone drops the notice as noSubscription and removes them all", async () => {
    const { app, world, push } = await given();
    await seed(app, [noticeFor(world)], [device(world, 1)]);
    push.respondWith(() => ({ kind: "gone" }));
    await dispatch(app, push, NOON);
    expect(only(app)).toMatchObject({ state: "dropped", outcome: "noSubscription" });
    expect(app.pushSubscriptions.all()).toEqual([]);
  });

  it("a refusal from every device fails the notice as rejected", async () => {
    const { app, world, push } = await given();
    await seed(app, [noticeFor(world)], [device(world, 1)]);
    push.respondWith(() => ({ kind: "rejected", status: 400 }));
    await dispatch(app, push, NOON);
    expect(only(app)).toMatchObject({ state: "failed", outcome: "rejected" });
  });

  it("an endpoint the sender does not accept is never sent to", async () => {
    const { app, world } = await given();
    const push = createRecordingPushSender({ accepts: () => false });
    await seed(app, [noticeFor(world)], [device(world, 1)]);
    await dispatch(app, push, NOON);
    expect(push.sent).toEqual([]);
    expect(only(app)).toMatchObject({ state: "failed", outcome: "rejected" });
  });
});

describe("dispatchNotifications: retries", () => {
  it("SC-O8: retries with backoff 1, 5, 15 and 60 minutes, then fails as exhausted", async () => {
    const { app, world, push } = await given();
    await seed(app, [noticeFor(world)], [device(world, 1)]);
    push.respondWith(() => ({ kind: "retry", retryAfterSeconds: null }));

    let now: number = NOON;
    const waits: number[] = [];
    for (let attempt = 1; attempt <= 5; attempt++) {
      const result = await dispatch(app, push, instant(now));
      expect(result.ok && result.value.claimed).toBe(1);
      const row = only(app);
      if (row.state !== "pending") break;
      waits.push((row.notBefore - now) / MIN);
      // Just before the backoff ends nothing is claimed.
      expect((await dispatch(app, push, instant(row.notBefore - 1))).ok).toBe(true);
      now = row.notBefore;
    }
    expect(waits).toEqual([1, 5, 15, 60]);
    expect(only(app)).toMatchObject({ state: "failed", outcome: "exhausted", attempts: 5 });
    expect(push.sent).toHaveLength(5);
  });

  it("honours Retry-After when the push service gives one", async () => {
    const { app, world, push } = await given();
    await seed(app, [noticeFor(world)], [device(world, 1)]);
    push.respondWith(() => ({ kind: "retry", retryAfterSeconds: 600 }));
    await dispatch(app, push, NOON);
    expect(only(app)).toMatchObject({ state: "pending", notBefore: instant(NOON + 10 * MIN) });
  });
});

describe("dispatchNotifications: timing", () => {
  it("SC-O3: inside quiet hours the notice waits for 08:00, and the attempt is given back", async () => {
    const { app, world, push } = await given();
    await seed(
      app,
      [noticeFor(world, { notBefore: at("2026-10-06", 23, 10), expiresAt: at("2026-10-07", 23) })],
      [device(world, 1)],
    );
    const result = await dispatch(app, push, at("2026-10-06", 23, 10));
    expect(result.ok && result.value.deferred).toBe(1);
    expect(push.sent).toEqual([]);
    expect(only(app)).toMatchObject({
      state: "pending",
      attempts: 0,
      notBefore: at("2026-10-07", 8),
    });
    await dispatch(app, push, at("2026-10-07", 8));
    expect(only(app)).toMatchObject({ state: "sent" });
  });

  it("SC-O4: a morning notice still unsent at 22:00 rolls over to the next day once, then drops", async () => {
    const { app, world, push } = await given();
    await seed(
      app,
      [
        noticeFor(world, {
          notBefore: at("2026-10-06", 9),
          expiresAt: at("2026-10-06", 22),
          rolloversLeft: 1,
        }),
      ],
      [device(world, 1)],
    );
    await dispatch(app, push, at("2026-10-06", 22, 30));
    expect(only(app)).toMatchObject({
      state: "pending",
      attempts: 0,
      rolloversLeft: 0,
      notBefore: at("2026-10-07", 9),
      expiresAt: at("2026-10-07", 22),
    });
    await dispatch(app, push, at("2026-10-07", 22, 30));
    expect(only(app)).toMatchObject({ state: "dropped", outcome: "expired" });
    expect(push.sent).toEqual([]);
  });
});

describe("dispatchNotifications: relevance at send time", () => {
  it("SC-O9: a recipient who left the circle is dropped", async () => {
    const { app, world, push } = await given();
    await seed(app, [noticeFor(world)], [device(world, 1)]);
    const [andrea, victor, sofia] = world.circle.members;
    if (!andrea || !victor || !sofia) throw new Error("fixture");
    await app.circles.save(
      {
        ...world.circle,
        members: [andrea, { ...victor, status: "left", leftAt: NOON }, sofia],
        version: world.circle.version + 1,
      },
      world.circle.version,
    );
    await dispatch(app, push, NOON);
    expect(only(app)).toMatchObject({ state: "dropped", outcome: "recipientLeft" });
    expect(push.sent).toEqual([]);
  });

  it("SC-O7: a pauseRequested whose pause was cancelled is dropped", async () => {
    const { app, world, push } = await given();
    const request = await requestPause(app, world.andrea, {
      seasonId: world.season.id,
      scope: { kind: "commitment", commitmentId: world.andreaCommitment },
      reason: "work",
      note: null,
      startDate: dayOf(6),
      endDate: dayOf(7),
    });
    if (!request.ok) throw new Error("fixture failed");
    await seed(app, [], [device(world, 1), device(world, 2, "andrea")]);
    const cancelled = await cancelPauseRequest(app, world.andrea, {
      pauseRequestId: request.value.id,
    });
    expect(cancelled.ok).toBe(true);

    await dispatch(app, push, NOON);

    const toVictor = app.notifications.all().find((n) => n.recipientMemberId === "member-victor");
    expect(toVictor).toMatchObject({ state: "dropped", outcome: "irrelevant" });
  });

  it("REQ-K1/Y1: a pause notice carries ids only, never a name, a note or a habit", async () => {
    const { app, world, push } = await given();
    const request = await requestPause(app, world.andrea, {
      seasonId: world.season.id,
      scope: { kind: "commitment", commitmentId: world.andreaCommitment },
      reason: "health",
      note: "Rodilla",
      startDate: dayOf(6),
      endDate: dayOf(7),
    });
    if (!request.ok) throw new Error("fixture failed");
    await seed(app, [], [device(world, 1)]);
    await dispatch(app, push, NOON);
    const text = JSON.stringify(push.sent.map((p) => p.payload));
    expect(push.sent).toHaveLength(1);
    for (const secret of [
      "Andrea",
      "Victor",
      "Meditar",
      "Rodilla",
      "health",
      world.andreaCommitment,
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("a notice whose season is gone is dropped as irrelevant", async () => {
    const { app, world, push } = await given();
    await seed(
      app,
      [noticeFor(world, { seasonId: "season-gone" as OutboxNotice["seasonId"] })],
      [device(world, 1)],
    );
    await dispatch(app, push, NOON);
    expect(only(app)).toMatchObject({ state: "dropped", outcome: "irrelevant" });
  });
});

describe("dispatchNotifications: housekeeping", () => {
  it("REQ-O15: final rows are purged seven days after they finished", async () => {
    const { app, world, push } = await given();
    await seed(app, [noticeFor(world)], [device(world, 1)]);
    await dispatch(app, push, NOON);
    await dispatch(app, push, instant(NOON + 7 * 86_400_000 - 1));
    expect(app.notifications.all()).toHaveLength(1);
    await dispatch(app, push, instant(NOON + 7 * 86_400_000 + 1));
    expect(app.notifications.all()).toEqual([]);
  });

  it("a pactPendingApproval is dropped once the recipient approved", async () => {
    const app = createTestApp({ now: instant(1_759_060_800_000) });
    const { givenOpenPactWithOneApproval } = await import("../testing/pact-fixtures.ts");
    const { season, victor } = await givenOpenPactWithOneApproval(app);
    await app.pushSubscriptions.upsert(
      pushSubscriptionFixture({ userId: victor.userId, endpoint: "https://push.example/v" }),
    );
    await approvePact(app, victor, {
      seasonId: season.id,
      expectedPactRevision: season.pactRevision,
    });
    const push = createRecordingPushSender();
    await dispatchNotifications({ ...app, push }, {});
    expect(push.sent).toEqual([]);
    expect(app.notifications.all()[0]).toMatchObject({ state: "dropped", outcome: "irrelevant" });
  });
});
