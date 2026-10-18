import type { TodayView } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import { FakeNotificationPermission } from "../../testing/fake-notification-permission.ts";
import { FakePactJoyApi } from "../../testing/fake-pactjoy-api.ts";
import { FakePushSubscription } from "../../testing/fake-push-subscription.ts";
import {
  dropThisDeviceLocally,
  enablePush,
  pushStatus,
  removeThisDevice,
  resyncOnStart,
  syncPush,
} from "./push-device.ts";

/**
 * This device's Web Push lifecycle (ADR-0017, REQ-X5..X7, REQ-N1..N3): permission from a tap,
 * subscribe and register, re-sync on start, remove on sign-out or when the permission is revoked.
 */

function given(
  permission: ConstructorParameters<typeof FakeNotificationPermission>[0] = "default",
) {
  const deps = {
    permission: new FakeNotificationPermission(permission),
    push: new FakePushSubscription(),
    api: new FakePactJoyApi({} as TodayView),
  };
  return deps;
}

describe("enablePush (from the Activar tap)", () => {
  it("asks the permission before anything is awaited, then subscribes and registers (SC-X1)", async () => {
    const deps = given();
    const pending = enablePush(deps);
    expect(deps.permission.requests).toBe(1);
    expect(deps.api.calls.getPushConfig).toBe(0);
    expect(await pending).toBe("active");
    expect([...deps.api.pushDevices.keys()]).toEqual(["https://web.push.apple.com/device-1"]);
    expect(deps.push.subscribes).toEqual(["BFAKE-VAPID-KEY"]);
  });

  it("SC-X4: a denial subscribes nothing and registers nothing", async () => {
    const deps = given();
    deps.permission.answer = "denied";
    expect(await enablePush(deps)).toBe("blocked");
    expect(deps.push.subscribes).toEqual([]);
    expect(deps.api.calls.savePushSubscription).toBe(0);
  });

  it("an unanswered prompt leaves it off", async () => {
    const deps = given();
    deps.permission.answer = "default";
    expect(await enablePush(deps)).toBe("off");
  });
});

describe("syncPush", () => {
  it("SC-X2: an existing subscription with the same key is registered again, not remade", async () => {
    const deps = given("granted");
    await syncPush(deps);
    await syncPush(deps);
    expect(deps.push.subscribes).toHaveLength(1);
    expect(deps.api.calls.savePushSubscription).toBe(2);
    expect(deps.api.pushDevices.size).toBe(1);
  });

  it("resubscribes after the server rotated its key", async () => {
    const deps = given("granted");
    await syncPush(deps);
    deps.api.vapidPublicKey = "BROTATED";
    await syncPush(deps);
    expect(deps.push.unsubscribes).toBe(1);
    expect(deps.push.subscribes).toEqual(["BFAKE-VAPID-KEY", "BROTATED"]);
  });

  it("is unavailable when the browser cannot or the server has no push", async () => {
    const unsupported = given("granted");
    unsupported.push.isSupported = false;
    expect(await syncPush(unsupported)).toBe("unavailable");
    const noServer = given("granted");
    noServer.api.vapidPublicKey = null;
    expect(await syncPush(noServer)).toBe("unavailable");
    expect(noServer.push.subscribes).toEqual([]);
  });
});

describe("resyncOnStart", () => {
  it("re-registers the device when the permission is granted", async () => {
    const deps = given("granted");
    await resyncOnStart(deps);
    expect(deps.api.pushDevices.size).toBe(1);
  });

  it("REQ-X6: a revoked permission removes the leftover subscription here and on the server", async () => {
    const deps = given("granted");
    await syncPush(deps);
    deps.permission.current = "denied";
    await resyncOnStart(deps);
    expect(deps.push.device).toBeNull();
    expect(deps.api.pushDevices.size).toBe(0);
  });

  it("does nothing, and never throws, without permission or support", async () => {
    const deps = given("default");
    await resyncOnStart(deps);
    expect(deps.api.calls.getPushConfig).toBe(0);
    const broken = given("granted");
    broken.push.refuse = new Error("blocked");
    await expect(resyncOnStart(broken)).resolves.toBeUndefined();
  });
});

describe("removeThisDevice (sign-out)", () => {
  it("REQ-X7: tells the server first, then drops the browser subscription", async () => {
    const deps = given("granted");
    await syncPush(deps);
    await removeThisDevice(deps);
    expect(deps.api.pushDevices.size).toBe(0);
    expect(deps.push.device).toBeNull();
  });

  it("is best effort: an API failure still drops the browser subscription and never throws", async () => {
    const deps = given("granted");
    await syncPush(deps);
    deps.api.failNext("removePushSubscription", new Error("offline") as never);
    await expect(removeThisDevice(deps)).resolves.toBeUndefined();
    expect(deps.push.device).toBeNull();
  });
});

describe("dropThisDeviceLocally (the account was deleted)", () => {
  it("drops the browser subscription without calling the API: the server already erased the user", async () => {
    const deps = given("granted");
    await syncPush(deps);
    const calls = deps.api.calls.removePushSubscription;
    await dropThisDeviceLocally(deps.push);
    expect(deps.push.device).toBeNull();
    expect(deps.api.calls.removePushSubscription).toBe(calls);
  });

  it("does nothing where push is not supported", async () => {
    const deps = given("granted");
    await syncPush(deps);
    deps.push.isSupported = false;
    await dropThisDeviceLocally(deps.push);
    expect(deps.push.device).not.toBeNull();
  });

  it("never throws when the browser refuses", async () => {
    const deps = given("granted");
    await syncPush(deps);
    deps.push.unsubscribe = async () => {
      throw new Error("blocked");
    };
    await expect(dropThisDeviceLocally(deps.push)).resolves.toBeUndefined();
  });
});

describe("pushStatus (the Ajustes row)", () => {
  const status = (deps: ReturnType<typeof given>, installed = true) =>
    pushStatus({ ...deps, installed });

  it.each([
    ["granted and registered", "granted", true, "active"],
    ["granted without a subscription", "granted", false, "off"],
    ["not asked yet", "default", false, "off"],
    ["denied", "denied", false, "blocked"],
  ] as const)("%s reads %s", async (_name, permission, subscribed, expected) => {
    const deps = given(permission);
    if (subscribed) await syncPush(deps);
    expect(await status(deps)).toBe(expected);
  });

  it("REQ-N3: not installed on the home screen is its own state, before any permission", async () => {
    const deps = given("default");
    deps.push.isSupported = false;
    expect(await status(deps, false)).toBe("notInstalled");
    expect(await status(deps, true)).toBe("unavailable");
  });

  it("a server without push is unavailable", async () => {
    const deps = given("granted");
    deps.api.vapidPublicKey = null;
    expect(await status(deps)).toBe("unavailable");
  });
});
