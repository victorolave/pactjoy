import { describe, expect, it, vi } from "vitest";
import {
  BrowserNotificationPermission,
  type NotificationApi,
} from "./browser-notification-permission.ts";

const api = (permission: NotificationApi["permission"], answer = permission): NotificationApi => ({
  permission,
  requestPermission: vi.fn().mockResolvedValue(answer),
});

describe("BrowserNotificationPermission", () => {
  it("reports unsupported where the browser has no Notification API", async () => {
    const permission = new BrowserNotificationPermission(undefined);
    expect(permission.state()).toBe("unsupported");
    await expect(permission.request()).resolves.toBe("unsupported");
  });

  it.each(["default", "granted", "denied"] as const)("reads the %s permission", (state) => {
    expect(new BrowserNotificationPermission(api(state)).state()).toBe(state);
  });

  it("asks the browser and returns its answer", async () => {
    const notification = api("default", "granted");
    await expect(new BrowserNotificationPermission(notification).request()).resolves.toBe(
      "granted",
    );
    expect(notification.requestPermission).toHaveBeenCalledTimes(1);
  });

  it("starts the browser's request synchronously, inside the caller's tap", () => {
    const notification = api("default", "denied");
    void new BrowserNotificationPermission(notification).request();
    expect(notification.requestPermission).toHaveBeenCalledTimes(1);
  });

  it("resolves from the callback on a browser that only has the callback form", async () => {
    const notification: NotificationApi = {
      permission: "default",
      requestPermission: vi.fn((callback) => {
        setTimeout(() => callback?.("granted"), 0);
        return undefined;
      }),
    };
    await expect(new BrowserNotificationPermission(notification).request()).resolves.toBe(
      "granted",
    );
    expect(notification.requestPermission).toHaveBeenCalledTimes(1);
  });

  it("resolves from the returned promise when the browser does not call the callback", async () => {
    const notification: NotificationApi = {
      permission: "default",
      requestPermission: vi.fn(() => Promise.resolve("denied" as const)),
    };
    await expect(new BrowserNotificationPermission(notification).request()).resolves.toBe("denied");
  });

  it("does not resolve early while a callback-only prompt is still open", async () => {
    let answer: ((permission: "granted") => void) | undefined;
    const notification: NotificationApi = {
      permission: "default",
      requestPermission: vi.fn((callback) => {
        answer = callback;
        return undefined;
      }),
    };
    let settled = false;
    const pending = new BrowserNotificationPermission(notification).request().then((state) => {
      settled = true;
      return state;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    answer?.("granted");
    await expect(pending).resolves.toBe("granted");
  });

  it("never rejects: a failing request answers the current state", async () => {
    const rejecting = {
      permission: "default" as const,
      requestPermission: vi.fn().mockRejectedValue(new Error("nope")),
    };
    const throwing = {
      permission: "default" as const,
      requestPermission: vi.fn(() => {
        throw new Error("nope");
      }),
    };
    await expect(new BrowserNotificationPermission(rejecting).request()).resolves.toBe("default");
    await expect(new BrowserNotificationPermission(throwing).request()).resolves.toBe("default");
  });
});
