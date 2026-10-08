import { describe, expect, it } from "vitest";
import { LocalStorageDeviceStore } from "../adapters/local-storage-device-store.ts";
import { MemoryStorage } from "../testing/memory-storage.ts";
import { weeklySummaryDismissalKey } from "./weekly-summary-dismissal.ts";

describe("device-local weekly summary flags", () => {
  it("survives session end and reload, but not on a different device", () => {
    const storage = new MemoryStorage();
    const device = new LocalStorageDeviceStore(storage);
    const key = weeklySummaryDismissalKey("member-victor", "season-1", 3);
    device.set(key, "1");
    device.clearSession();
    expect(new LocalStorageDeviceStore(storage).get(key)).toBe("1");
    expect(new LocalStorageDeviceStore(new MemoryStorage()).get(key)).toBeNull();
  });
  it("isolates members, seasons and weeks without delimiter collisions", () => {
    const key = weeklySummaryDismissalKey;
    const keys = [
      key("m", "s", 1),
      key("n", "s", 1),
      key("m", "t", 1),
      key("m", "s", 2),
      key("m:s", "t", 1),
      key("m", "s:t", 1),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});
