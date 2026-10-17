import { describe, expect, it } from "vitest";
import { userId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { createRecordingPushSender } from "../testing/recording-push-sender.ts";
import { instant } from "../time/instant.ts";
import { pushConfig, removePushSubscription, savePushSubscription } from "./push-subscriptions.ts";

/**
 * The device side of Web Push (ADR-0017, REQ-X1..X4): a signed-in user registers or removes the
 * subscription of the device they are on. User-level: no circle is needed.
 */

const ANDREA = { userId: userId("user-andrea") };
const VICTOR = { userId: userId("user-victor") };
const ENDPOINT = "https://web.push.apple.com/device-1";
const KEYS = { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) };

function given(push = createRecordingPushSender({ accepts: (e) => e.includes("push.apple.com") })) {
  const app = createTestApp();
  return { app, deps: { ...app, push } };
}

describe("savePushSubscription", () => {
  it("SC-X1: stores the caller's device", async () => {
    const { app, deps } = given();
    expect(await savePushSubscription(deps, ANDREA, { endpoint: ENDPOINT, keys: KEYS })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(app.pushSubscriptions.all()).toMatchObject([
      { userId: ANDREA.userId, endpoint: ENDPOINT, ...KEYS, lastSeenAt: app.clock.now() },
    ]);
  });

  it("SC-X2: saving the same device twice keeps one row", async () => {
    const { app, deps } = given();
    await savePushSubscription(deps, ANDREA, { endpoint: ENDPOINT, keys: KEYS });
    await savePushSubscription(deps, ANDREA, { endpoint: ENDPOINT, keys: KEYS });
    expect(app.pushSubscriptions.all()).toHaveLength(1);
  });

  it("SC-X3: the same device signed in as someone else moves to them", async () => {
    const { app, deps } = given();
    await savePushSubscription(deps, ANDREA, { endpoint: ENDPOINT, keys: KEYS });
    await savePushSubscription(deps, VICTOR, { endpoint: ENDPOINT, keys: KEYS });
    expect(app.pushSubscriptions.all().map((d) => d.userId)).toEqual([VICTOR.userId]);
  });

  it("keeps at most ten devices per user, dropping the least recently seen", async () => {
    const { app, deps } = given();
    for (let n = 0; n < 12; n++) {
      await savePushSubscription(
        { ...deps, clock: { now: () => instant(1_700_000_000_000 + n) } },
        ANDREA,
        { endpoint: `${ENDPOINT}-${n}`, keys: KEYS },
      );
    }
    const kept = app.pushSubscriptions.all().map((d) => d.endpoint);
    expect(kept).toHaveLength(10);
    expect(kept).not.toContain(`${ENDPOINT}-0`);
    expect(kept).not.toContain(`${ENDPOINT}-1`);
  });

  it.each([
    [
      "an endpoint the sender does not accept (SSRF)",
      { endpoint: "https://evil.example/x", keys: KEYS },
    ],
    ["an http endpoint", { endpoint: "http://web.push.apple.com/x", keys: KEYS }],
    ["an oversized endpoint", { endpoint: `${ENDPOINT}/${"x".repeat(1024)}`, keys: KEYS }],
    ["a short p256dh", { endpoint: ENDPOINT, keys: { ...KEYS, p256dh: "BAAA" } }],
    ["a compressed point", { endpoint: ENDPOINT, keys: { ...KEYS, p256dh: `A${"A".repeat(86)}` } }],
    ["a non-base64url auth", { endpoint: ENDPOINT, keys: { ...KEYS, auth: "+".repeat(22) } }],
    ["a missing key", { endpoint: ENDPOINT, keys: { p256dh: KEYS.p256dh } }],
    ["a non-string endpoint", { endpoint: 42, keys: KEYS }],
  ])("REQ-X3: rejects %s and stores nothing", async (_name, input) => {
    const { app, deps } = given();
    expect(await savePushSubscription(deps, ANDREA, input as never)).toEqual({
      ok: false,
      error: { kind: "InvalidPushSubscription" },
    });
    expect(app.pushSubscriptions.all()).toEqual([]);
  });

  it("accepts keys with the padding some browsers add", async () => {
    const { app, deps } = given();
    const result = await savePushSubscription(deps, ANDREA, {
      endpoint: ENDPOINT,
      keys: { p256dh: `${KEYS.p256dh}=`, auth: `${KEYS.auth}==` },
    });
    expect(result.ok).toBe(true);
    expect(app.pushSubscriptions.all()[0]).toMatchObject(KEYS);
  });

  it("is PushNotConfigured when the server has no push sender", async () => {
    const app = createTestApp();
    expect(
      await savePushSubscription({ ...app, push: null }, ANDREA, {
        endpoint: ENDPOINT,
        keys: KEYS,
      }),
    ).toEqual({ ok: false, error: { kind: "PushNotConfigured" } });
  });
});

describe("removePushSubscription", () => {
  it("removes the caller's own device and is idempotent", async () => {
    const { app, deps } = given();
    await savePushSubscription(deps, ANDREA, { endpoint: ENDPOINT, keys: KEYS });
    expect(await removePushSubscription(deps, ANDREA, { endpoint: ENDPOINT })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await removePushSubscription(deps, ANDREA, { endpoint: ENDPOINT })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(app.pushSubscriptions.all()).toEqual([]);
  });

  it("SC-X5: cannot remove someone else's device", async () => {
    const { app, deps } = given();
    await savePushSubscription(deps, ANDREA, { endpoint: ENDPOINT, keys: KEYS });
    await removePushSubscription(deps, VICTOR, { endpoint: ENDPOINT });
    expect(app.pushSubscriptions.all()).toHaveLength(1);
  });

  it("rejects a malformed endpoint", async () => {
    const { deps } = given();
    expect(await removePushSubscription(deps, ANDREA, { endpoint: 7 } as never)).toEqual({
      ok: false,
      error: { kind: "InvalidPushSubscription" },
    });
  });
});

describe("pushConfig", () => {
  it("gives the public VAPID key, or null when push is not configured", () => {
    const push = createRecordingPushSender();
    expect(pushConfig({ push })).toEqual({ vapidPublicKey: push.applicationServerKey });
    expect(pushConfig({ push: null })).toEqual({ vapidPublicKey: null });
  });
});
