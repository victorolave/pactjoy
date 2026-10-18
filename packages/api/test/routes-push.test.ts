import { createRecordingPushSender } from "@pactjoy/app/testing";
import { describe, expect, it } from "vitest";
import { ANDREA, setup } from "./harness.ts";

/**
 * The device's Web Push routes (ADR-0017, REQ-X1..X4): the public VAPID key, and the caller's own
 * subscription (PUT to register, POST .../remove to remove). Nothing about another user is ever
 * readable.
 */

const BODY = {
  endpoint: "https://web.push.apple.com/device-1",
  keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
};

const withPush = () => {
  const push = createRecordingPushSender({ accepts: (e) => e.includes("push.apple.com") });
  return { push, ...setup({ push }) };
};

describe("GET /me/push-config", () => {
  it("gives the public VAPID key", async () => {
    const { call, push } = withPush();
    const res = await call("GET", "/me/push-config", "andrea");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ data: { vapidPublicKey: push.applicationServerKey } });
  });

  it("gives null when push is not configured", async () => {
    const { call } = setup();
    expect((await call("GET", "/me/push-config", "andrea")).json).toEqual({
      data: { vapidPublicKey: null },
    });
  });
});

describe("PUT /me/push-subscription", () => {
  it("SC-X1: stores the caller's device and answers 200 with no data", async () => {
    const { app, call } = withPush();
    const res = await call("PUT", "/me/push-subscription", "andrea", BODY);
    expect(res).toEqual({ status: 200, json: { data: null } });
    expect(app.pushSubscriptions.all()).toMatchObject([
      { userId: ANDREA, endpoint: BODY.endpoint },
    ]);
  });

  it("accepts the browser's toJSON shape, expirationTime included (ignored)", async () => {
    const { call } = withPush();
    const res = await call("PUT", "/me/push-subscription", "andrea", {
      ...BODY,
      expirationTime: null,
    });
    expect(res.status).toBe(200);
  });

  it("REQ-X3: 422 InvalidPushSubscription for an endpoint outside the push services", async () => {
    const { app, call } = withPush();
    const res = await call("PUT", "/me/push-subscription", "andrea", {
      ...BODY,
      endpoint: "https://169.254.169.254/latest",
    });
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe("InvalidPushSubscription");
    expect(app.pushSubscriptions.all()).toEqual([]);
  });

  it("422 InvalidRequest for a body of the wrong shape", async () => {
    const { call } = withPush();
    const res = await call("PUT", "/me/push-subscription", "andrea", { endpoint: BODY.endpoint });
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe("InvalidRequest");
  });

  it("409 PushNotConfigured when the server has no push sender", async () => {
    const { call } = setup();
    const res = await call("PUT", "/me/push-subscription", "andrea", BODY);
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("PushNotConfigured");
  });
});

describe("POST /me/push-subscription/remove", () => {
  it("removes the caller's device; a repeat is still 200", async () => {
    const { app, call } = withPush();
    await call("PUT", "/me/push-subscription", "andrea", BODY);
    const body = { endpoint: BODY.endpoint };
    expect(await call("POST", "/me/push-subscription/remove", "andrea", body)).toEqual({
      status: 200,
      json: { data: null },
    });
    expect((await call("POST", "/me/push-subscription/remove", "andrea", body)).status).toBe(200);
    expect(app.pushSubscriptions.all()).toEqual([]);
  });

  it("SC-X5: Victor cannot remove Andrea's device", async () => {
    const { app, call } = withPush();
    await call("PUT", "/me/push-subscription", "andrea", BODY);
    await call("POST", "/me/push-subscription/remove", "victor", { endpoint: BODY.endpoint });
    expect(app.pushSubscriptions.all()).toHaveLength(1);
  });
});

describe("401 on every push route", () => {
  it("rejects a missing token on all three", async () => {
    const { call } = withPush();
    const results = await Promise.all([
      call("GET", "/me/push-config", null),
      call("PUT", "/me/push-subscription", null, BODY),
      call("POST", "/me/push-subscription/remove", null, { endpoint: BODY.endpoint }),
    ]);
    expect(results.map((r) => r.status)).toEqual([401, 401, 401]);
  });
});
