import { beforeEach, describe, expect, it } from "vitest";
import { FakeAuth, fakeSession } from "../../../testing/fake-auth.ts";
import { FixedClock } from "../../../testing/fixed-clock.ts";
import { MemoryTokenStore } from "../../../testing/memory-token-store.ts";
import { SessionManager } from "./session-manager.ts";

const NOW_S = 1_800_000_000;

let auth: FakeAuth;
let store: MemoryTokenStore;
let clock: FixedClock;
let manager: SessionManager;

const setup = (expiresInSeconds: number) => {
  auth = new FakeAuth();
  clock = new FixedClock(NOW_S * 1000);
  store = new MemoryTokenStore(fakeSession({ expiresAt: NOW_S + expiresInSeconds }));
  manager = new SessionManager(auth, store, clock);
};

describe("SessionManager.getAccessToken", () => {
  it("returns null without a session", async () => {
    auth = new FakeAuth();
    store = new MemoryTokenStore();
    manager = new SessionManager(auth, store, new FixedClock(NOW_S * 1000));
    await expect(manager.getAccessToken()).resolves.toBeNull();
  });

  it("returns the stored token when more than 60 s remain (no refresh)", async () => {
    setup(61);
    await expect(manager.getAccessToken()).resolves.toBe("access-1");
    expect(auth.refreshed).toEqual([]);
  });

  it("refreshes when fewer than 60 s remain and stores the new session (AU-S7)", async () => {
    setup(59);
    await expect(manager.getAccessToken()).resolves.toBe("access-2");
    expect(auth.refreshed).toEqual(["refresh-1"]);
    expect(store.load()?.refreshToken).toBe("refresh-2");
  });

  it("refreshes once the clock moves into the 60 s window", async () => {
    setup(120);
    await manager.getAccessToken();
    expect(auth.refreshed).toEqual([]);
    clock.advanceSeconds(61);
    await manager.getAccessToken();
    expect(auth.refreshed).toEqual(["refresh-1"]);
  });

  it("shares one refresh between concurrent callers (single-flight)", async () => {
    setup(10);
    const release = auth.holdRefresh();
    const calls = Promise.all([
      manager.getAccessToken(),
      manager.getAccessToken(),
      manager.forceRefresh(),
    ]);
    release();
    await expect(calls).resolves.toEqual([
      "access-2",
      "access-2",
      { status: "ok", token: "access-2" },
    ]);
    expect(auth.refreshed).toHaveLength(1);
  });

  it("clears the session only when the refresh token is definitively rejected (AU-R4)", async () => {
    setup(10);
    auth.failNextWith("InvalidSession");
    await expect(manager.getAccessToken()).resolves.toBeNull();
    expect(store.load()).toBeNull();
  });

  it.each(["Network", "RateLimited", "Unknown"] as const)(
    "keeps the session and a still-valid token on a transient %s failure",
    async (code) => {
      setup(30);
      auth.failNextWith(code);
      await expect(manager.getAccessToken()).resolves.toBe("access-1");
      expect(store.load()).not.toBeNull();
    },
  );

  it.each(["Network", "RateLimited", "Unknown"] as const)(
    "reports a transient %s failure on forceRefresh and keeps the session",
    async (code) => {
      setup(3600);
      auth.failNextWith(code);
      await expect(manager.forceRefresh()).resolves.toEqual({ status: "transient" });
      expect(store.load()).not.toBeNull();
    },
  );

  it("reports a rejection on forceRefresh and clears the session", async () => {
    setup(3600);
    auth.failNextWith("InvalidSession");
    await expect(manager.forceRefresh()).resolves.toEqual({ status: "rejected" });
    expect(store.load()).toBeNull();
  });

  it("keeps the session but serves no token when it already expired and refresh is transient", async () => {
    setup(-5);
    auth.failNextWith("Network");
    await expect(manager.getAccessToken()).resolves.toBeNull();
    expect(store.load()).not.toBeNull();
  });
});

describe("a refresh rejected because another tab already rotated the token (AU-R4)", () => {
  it("keeps the session and uses the newer one the other tab stored", async () => {
    setup(10);
    const release = auth.holdRefresh();
    auth.failNextWith("InvalidSession");
    const pending = manager.getAccessToken();
    store.emitExternal(fakeSession({ accessToken: "access-other", refreshToken: "refresh-other" }));
    release();
    await expect(pending).resolves.toBe("access-other");
    expect(store.load()?.refreshToken).toBe("refresh-other");
  });

  it("still clears when the stored token is the one that was rejected", async () => {
    setup(10);
    auth.failNextWith("InvalidSession");
    await expect(manager.forceRefresh()).resolves.toEqual({ status: "rejected" });
    expect(store.load()).toBeNull();
  });
});

describe("SessionManager.forceRefresh and signOut", () => {
  beforeEach(() => setup(3600));

  it("refreshes even when the token is fresh", async () => {
    await expect(manager.forceRefresh()).resolves.toEqual({ status: "ok", token: "access-2" });
  });

  it("reports a rejection when there is no session to refresh", async () => {
    store.clear();
    await expect(manager.forceRefresh()).resolves.toEqual({ status: "rejected" });
    expect(auth.refreshed).toEqual([]);
  });

  it("signs out remotely and clears the store", async () => {
    await manager.signOut();
    expect(auth.signedOut).toEqual(["access-1"]);
    expect(store.load()).toBeNull();
  });

  it("clears the store even without a session", async () => {
    store.clear();
    await manager.signOut();
    expect(auth.signedOut).toEqual([]);
  });
});
