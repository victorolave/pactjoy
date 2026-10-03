import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSession } from "../testing/fake-auth.ts";
import { LocalStorageTokenStore, STORAGE_KEY } from "./local-storage-token-store.ts";

beforeEach(() => localStorage.clear());

describe("LocalStorageTokenStore", () => {
  it("round-trips a session", () => {
    const store = new LocalStorageTokenStore();
    const session = fakeSession({ email: null });
    store.save(session);
    expect(store.load()).toEqual(session);
  });

  it("clears the session", () => {
    const store = new LocalStorageTokenStore();
    store.save(fakeSession());
    store.clear();
    expect(store.load()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("treats corrupt or incomplete data as no session", () => {
    const store = new LocalStorageTokenStore();
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(store.load()).toBeNull();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ accessToken: "x" }));
    expect(store.load()).toBeNull();
  });

  it("notifies subscribers when another tab changes the session", () => {
    const store = new LocalStorageTokenStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const next = fakeSession({ accessToken: "from-other-tab" });

    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    expect(listener).toHaveBeenLastCalledWith(next);

    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    expect(listener).toHaveBeenLastCalledWith(null);

    unsubscribe();
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("ignores storage events for other keys", () => {
    const store = new LocalStorageTokenStore();
    const listener = vi.fn();
    store.subscribe(listener);
    window.dispatchEvent(new StorageEvent("storage", { key: "something-else" }));
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("LocalStorageTokenStore when storage throws (quota, Safari private mode)", () => {
  const throwingStorage = (): Storage => {
    const fail = () => {
      throw new DOMException("denied", "QuotaExceededError");
    };
    return {
      length: 0,
      key: () => null,
      clear: fail,
      getItem: fail,
      setItem: fail,
      removeItem: fail,
    };
  };

  it("load returns null instead of throwing", () => {
    expect(new LocalStorageTokenStore(throwingStorage()).load()).toBeNull();
  });

  it("save and clear do not throw", () => {
    const store = new LocalStorageTokenStore(throwingStorage());
    expect(() => store.save(fakeSession())).not.toThrow();
    expect(() => store.clear()).not.toThrow();
  });

  it("keeps the session in memory for this tab when persisting fails", () => {
    const store = new LocalStorageTokenStore(throwingStorage());
    const session = fakeSession();
    store.save(session);
    expect(store.load()).toEqual(session);
    store.clear();
    expect(store.load()).toBeNull();
  });

  it("a failed save leaves the previous session untouched in a working storage", () => {
    const store = new LocalStorageTokenStore();
    const session = fakeSession();
    store.save(session);
    const failing = new LocalStorageTokenStore({
      ...throwingStorage(),
      getItem: (key) => localStorage.getItem(key),
    });
    failing.save(fakeSession({ accessToken: "lost" }));
    expect(store.load()).toEqual(session);
  });
});
