import { describe, expect, it } from "vitest";
import {
  BrowserPushSubscription,
  type PushManagerLike,
  type PushSubscriptionLike,
} from "./browser-push-subscription.ts";

/** The device side of Web Push over `serviceWorker.ready.pushManager` (ADR-0017). */

const KEYS = { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) };
/** base64url of the bytes [1, 2, 255]. */
const SERVER_KEY = "AQL_";

function subscription(
  endpoint: string,
  serverKey: Uint8Array | null = null,
): PushSubscriptionLike & {
  unsubscribed: boolean;
} {
  const sub = {
    endpoint,
    options: { applicationServerKey: (serverKey?.buffer as ArrayBuffer | undefined) ?? null },
    unsubscribed: false,
    toJSON: () => ({ endpoint, expirationTime: null, keys: KEYS }),
    unsubscribe: async () => {
      sub.unsubscribed = true;
      return true;
    },
  };
  return sub;
}

function manager(existing: PushSubscriptionLike | null = null) {
  const calls: { userVisibleOnly: boolean; applicationServerKey: number[] }[] = [];
  let current = existing;
  const pushManager: PushManagerLike = {
    getSubscription: async () => current,
    subscribe: async (options) => {
      calls.push({
        userVisibleOnly: options.userVisibleOnly,
        applicationServerKey: [...options.applicationServerKey],
      });
      current = subscription("https://web.push.apple.com/new", options.applicationServerKey);
      return current;
    },
  };
  return {
    calls,
    adapter: new BrowserPushSubscription({ ready: Promise.resolve({ pushManager }) }),
  };
}

describe("BrowserPushSubscription", () => {
  it("is unsupported without a service worker container", () => {
    expect(new BrowserPushSubscription(undefined).supported()).toBe(false);
    expect(manager().adapter.supported()).toBe(true);
  });

  it("current is null when the device has no subscription", async () => {
    expect(await manager().adapter.current()).toBeNull();
  });

  it("current gives the endpoint, the keys and the server key it was made with", async () => {
    const { adapter } = manager(
      subscription("https://web.push.apple.com/a", new Uint8Array([1, 2, 255])),
    );
    expect(await adapter.current()).toEqual({
      subscription: { endpoint: "https://web.push.apple.com/a", keys: KEYS },
      serverKey: SERVER_KEY,
    });
  });

  it("subscribes visibly with the decoded server key", async () => {
    const { adapter, calls } = manager();
    const made = await adapter.subscribe(SERVER_KEY);
    expect(calls).toEqual([{ userVisibleOnly: true, applicationServerKey: [1, 2, 255] }]);
    expect(made).toEqual({ endpoint: "https://web.push.apple.com/new", keys: KEYS });
  });

  it("unsubscribe drops the device's subscription and gives its endpoint", async () => {
    const existing = subscription("https://web.push.apple.com/a");
    const { adapter } = manager(existing);
    expect(await adapter.unsubscribe()).toBe("https://web.push.apple.com/a");
    expect(existing.unsubscribed).toBe(true);
    expect(await manager().adapter.unsubscribe()).toBeNull();
  });

  it("current never rejects: a broken worker reads as no subscription", async () => {
    const adapter = new BrowserPushSubscription({ ready: Promise.reject(new Error("no sw")) });
    expect(await adapter.current()).toBeNull();
  });
});
