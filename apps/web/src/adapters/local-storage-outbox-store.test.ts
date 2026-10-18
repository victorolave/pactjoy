import { describe, expect, it, vi } from "vitest";
import { EMPTY_OUTBOX } from "../ports/outbox-store.ts";
import { MemoryStorage } from "../testing/memory-storage.ts";
import { describeOutboxStoreContract, sampleOutbox } from "../testing/outbox-store-contract.ts";
import { LocalStorageOutboxStore } from "./local-storage-outbox-store.ts";

describeOutboxStoreContract(
  "LocalStorageOutboxStore",
  () => new LocalStorageOutboxStore(new MemoryStorage()),
);

/** A window-like event target, so a test fires `storage` events without touching jsdom's window. */
function fakeEvents() {
  const target = new EventTarget();
  return {
    target,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    fire(key: string | null) {
      target.dispatchEvent(Object.assign(new Event("storage"), { key }));
    },
  };
}

describe("LocalStorageOutboxStore", () => {
  it("keeps each user's state under pactjoy.outbox.v1:<userId>", () => {
    const storage = new MemoryStorage();
    new LocalStorageOutboxStore(storage).save("user-1", sampleOutbox());
    expect(storage.length).toBe(1);
    expect(JSON.parse(storage.getItem("pactjoy.outbox.v1:user-1") ?? "null")).toEqual(
      sampleOutbox(),
    );
  });

  it("survives a restart: a new instance over the same storage sees the queue (OE-R3.S1)", () => {
    const storage = new MemoryStorage();
    new LocalStorageOutboxStore(storage).save("user-1", sampleOutbox());
    expect(new LocalStorageOutboxStore(storage).load("user-1")).toEqual(sampleOutbox());
  });

  it("leaves no key behind for an empty state", () => {
    const storage = new MemoryStorage();
    const store = new LocalStorageOutboxStore(storage);
    store.save("user-1", sampleOutbox());
    store.save("user-1", EMPTY_OUTBOX);
    expect(storage.length).toBe(0);
  });

  it("loads empty from corrupt JSON, a wrong version or a wrong shape", () => {
    const storage = new MemoryStorage();
    const store = new LocalStorageOutboxStore(storage);
    for (const bad of [
      "{not json",
      '{"v":2,"items":[],"notices":[]}',
      '{"v":1,"items":3}',
      "null",
    ]) {
      storage.setItem("pactjoy.outbox.v1:user-1", bad);
      expect(store.load("user-1")).toEqual(EMPTY_OUTBOX);
    }
  });

  it("keeps the state in memory when writes throw, and never throws (OE-R3.S3)", () => {
    const store = new LocalStorageOutboxStore({
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
      key: () => null,
      length: 0,
    } as unknown as Storage);
    expect(() => store.save("user-1", sampleOutbox())).not.toThrow();
    expect(store.load("user-1")).toEqual(sampleOutbox());
    store.clearAll();
    expect(store.load("user-1")).toEqual(EMPTY_OUTBOX);
  });

  it("prefers the newer memory copy over the stale stored one after a write failed", () => {
    const storage = new MemoryStorage();
    let full = false;
    const flaky = {
      get length() {
        return storage.length;
      },
      key: (index: number) => storage.key(index),
      getItem: (key: string) => storage.getItem(key),
      removeItem: (key: string) => storage.removeItem(key),
      setItem: (key: string, value: string) => {
        if (full) throw new Error("QuotaExceededError");
        storage.setItem(key, value);
      },
    } as unknown as Storage;
    const store = new LocalStorageOutboxStore(flaky, null);
    store.save("user-1", sampleOutbox());
    full = true;
    const newer = { ...sampleOutbox(), notices: [] };
    const bigger = { ...newer, items: [...newer.items, ...newer.items] };
    store.save("user-1", bigger);
    expect(store.load("user-1")).toEqual(bigger);
  });

  it("drops the memory copy when another tab writes the key, so its state is read", () => {
    const events = fakeEvents();
    const storage = new MemoryStorage();
    let full = true;
    const flaky = {
      get length() {
        return storage.length;
      },
      key: (index: number) => storage.key(index),
      getItem: (key: string) => storage.getItem(key),
      removeItem: (key: string) => storage.removeItem(key),
      setItem: (key: string, value: string) => {
        if (full) throw new Error("QuotaExceededError");
        storage.setItem(key, value);
      },
    } as unknown as Storage;
    const store = new LocalStorageOutboxStore(flaky, events);
    store.subscribe(() => undefined);
    store.save("user-1", sampleOutbox());
    expect(store.load("user-1")).toEqual(sampleOutbox());
    full = false;
    storage.removeItem("pactjoy.outbox.v1:user-1"); // another tab cleared it
    events.fire("pactjoy.outbox.v1:user-1");
    expect(store.load("user-1")).toEqual(EMPTY_OUTBOX);
  });

  it("works with no storage at all", () => {
    const store = new LocalStorageOutboxStore(null);
    store.save("user-1", sampleOutbox());
    expect(store.load("user-1")).toEqual(sampleOutbox());
    expect(() => store.clearAll()).not.toThrow();
  });

  it("does not let a stale memory copy hide a clear made by another tab", () => {
    const storage = new MemoryStorage();
    const store = new LocalStorageOutboxStore(storage);
    store.save("user-1", sampleOutbox());
    storage.removeItem("pactjoy.outbox.v1:user-1");
    expect(store.load("user-1")).toEqual(EMPTY_OUTBOX);
  });

  it("clearAll removes every outbox key and only those (OE-R6.S1)", () => {
    const storage = new MemoryStorage();
    storage.setItem("pactjoy.device.welcomeSeen", "1");
    const store = new LocalStorageOutboxStore(storage);
    store.save("user-1", sampleOutbox());
    store.save("user-2", sampleOutbox());
    store.clearAll();
    expect(storage.length).toBe(1);
    expect(storage.getItem("pactjoy.device.welcomeSeen")).toBe("1");
  });

  it("listens to the real window's storage events by default", () => {
    const store = new LocalStorageOutboxStore(new MemoryStorage());
    const onChange = vi.fn();
    const unsubscribe = store.subscribe(onChange);
    window.dispatchEvent(new StorageEvent("storage", { key: "pactjoy.outbox.v1:user-1" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("tells a subscriber when another tab changes an outbox key, and ignores other keys (OE-R3.S4)", () => {
    const events = fakeEvents();
    const store = new LocalStorageOutboxStore(new MemoryStorage(), events);
    const onChange = vi.fn();
    const unsubscribe = store.subscribe(onChange);
    events.fire("pactjoy.device.welcomeSeen");
    expect(onChange).not.toHaveBeenCalled();
    events.fire("pactjoy.outbox.v1:user-1");
    expect(onChange).toHaveBeenCalledTimes(1);
    events.fire(null); // storage.clear() in another tab
    expect(onChange).toHaveBeenCalledTimes(2);
    unsubscribe();
    events.fire("pactjoy.outbox.v1:user-1");
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
