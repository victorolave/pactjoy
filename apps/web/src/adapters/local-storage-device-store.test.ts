import { describe, expect, it } from "vitest";
import type { DeviceKey } from "../ports/device-store.ts";
import { MemoryStorage } from "../testing/memory-storage.ts";
import { LocalStorageDeviceStore } from "./local-storage-device-store.ts";

const ALL: readonly DeviceKey[] = ["welcomeSeen", "installStep", "notificationStep", "nameDraft"];

describe("LocalStorageDeviceStore", () => {
  it("round-trips a value and removes it", () => {
    const store = new LocalStorageDeviceStore(new MemoryStorage());
    expect(store.get("nameDraft")).toBeNull();
    store.set("nameDraft", "Andrea");
    expect(store.get("nameDraft")).toBe("Andrea");
    store.remove("nameDraft");
    expect(store.get("nameDraft")).toBeNull();
  });

  it("persists across instances over the same storage (reload keeps the draft)", () => {
    const storage = new MemoryStorage();
    new LocalStorageDeviceStore(storage).set("nameDraft", "Andrea");
    expect(new LocalStorageDeviceStore(storage).get("nameDraft")).toBe("Andrea");
  });

  it("clearSession drops only the name draft; device flags survive sign out", () => {
    const store = new LocalStorageDeviceStore(new MemoryStorage());
    for (const key of ALL) store.set(key, "1");
    store.clearSession();
    expect(ALL.map((key) => store.get(key))).toEqual(["1", "1", "1", null]);
  });

  it("namespaces its keys away from the session and the cache", () => {
    const storage = new MemoryStorage();
    new LocalStorageDeviceStore(storage).set("welcomeSeen", "1");
    expect(storage.getItem("pactjoy.device.welcomeSeen")).toBe("1");
    expect(storage.length).toBe(1);
  });

  it("keeps working in memory when storage is null or throws", () => {
    const none = new LocalStorageDeviceStore(null);
    none.set("welcomeSeen", "1");
    expect(none.get("welcomeSeen")).toBe("1");
    const broken = new LocalStorageDeviceStore({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage);
    broken.set("installStep", "1");
    expect(broken.get("installStep")).toBe("1");
    expect(() => broken.clearSession()).not.toThrow();
  });

  it("keeps a value in memory when storage reads fine but drops writes (quota full, Safari private)", () => {
    const dropsWrites = new LocalStorageDeviceStore({
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
    } as unknown as Storage);
    dropsWrites.set("welcomeSeen", "1");
    expect(dropsWrites.get("welcomeSeen")).toBe("1");
    dropsWrites.remove("welcomeSeen");
    expect(dropsWrites.get("welcomeSeen")).toBeNull();
  });
});
