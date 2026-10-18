import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { circleId, pushSubscriptionId, userId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { outboxNoticeFixture, pushSubscriptionFixture } from "../testing/notification-fixtures.ts";
import { dropCircleNotifications, eraseMemberNotifications } from "./erase.ts";

const ANDREA_USER = userId("user-andrea");
const VICTOR_USER = userId("user-victor");
const ANDREA = memberId("member-andrea");
const VICTOR = memberId("member-victor");
const CIRCLE = circleId("circle-1");
const OTHER_CIRCLE = circleId("circle-2");

async function seeded() {
  const app = createTestApp();
  await app.uow.transaction(async ({ notifications, pushSubscriptions }) => {
    await notifications.enqueue([
      outboxNoticeFixture({
        dedupeKey: "a-1",
        recipientUserId: ANDREA_USER,
        recipientMemberId: ANDREA,
        circleId: CIRCLE,
      }),
      outboxNoticeFixture({
        dedupeKey: "a-2",
        recipientUserId: ANDREA_USER,
        recipientMemberId: ANDREA,
        circleId: OTHER_CIRCLE,
      }),
      outboxNoticeFixture({
        dedupeKey: "v-1",
        recipientUserId: VICTOR_USER,
        recipientMemberId: VICTOR,
        circleId: CIRCLE,
      }),
      outboxNoticeFixture({
        dedupeKey: "v-2",
        recipientUserId: VICTOR_USER,
        recipientMemberId: VICTOR,
        circleId: OTHER_CIRCLE,
      }),
    ]);
    await pushSubscriptions.upsert(
      pushSubscriptionFixture({
        id: pushSubscriptionId("d-a1"),
        userId: ANDREA_USER,
        endpoint: "https://web.push.apple.com/a1",
      }),
    );
    await pushSubscriptions.upsert(
      pushSubscriptionFixture({
        id: pushSubscriptionId("d-a2"),
        userId: ANDREA_USER,
        endpoint: "https://web.push.apple.com/a2",
      }),
    );
    await pushSubscriptions.upsert(
      pushSubscriptionFixture({
        id: pushSubscriptionId("d-v1"),
        userId: VICTOR_USER,
        endpoint: "https://web.push.apple.com/v1",
      }),
    );
    return ok(undefined);
  });
  return app;
}

describe("eraseMemberNotifications", () => {
  it("deletes the user's notices in every circle and every device, and keeps a peer's", async () => {
    const app = await seeded();
    await app.uow.transaction(async (repos) => {
      await eraseMemberNotifications(repos, ANDREA_USER, [ANDREA]);
      return ok(undefined);
    });
    expect(app.notifications.all().map((n) => n.dedupeKey)).toEqual(["v-1", "v-2"]);
    expect(app.pushSubscriptions.all().map((d) => d.id)).toEqual([pushSubscriptionId("d-v1")]);
  });

  it("is undone when the transaction rolls back", async () => {
    const app = await seeded();
    await expect(
      app.uow.transaction(async (repos) => {
        await eraseMemberNotifications(repos, ANDREA_USER, [ANDREA]);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(app.notifications.all()).toHaveLength(4);
    expect(app.pushSubscriptions.all()).toHaveLength(3);
  });
});

describe("dropCircleNotifications", () => {
  it("deletes every notice of the circles for every recipient and keeps other circles", async () => {
    const app = await seeded();
    await app.uow.transaction(async (repos) => {
      await dropCircleNotifications(repos, [CIRCLE]);
      return ok(undefined);
    });
    expect(app.notifications.all().map((n) => n.dedupeKey)).toEqual(["a-2", "v-2"]);
    expect(app.pushSubscriptions.all()).toHaveLength(3);
  });
});
