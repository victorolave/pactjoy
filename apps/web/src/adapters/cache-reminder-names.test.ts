import { describe, expect, it } from "vitest";
import { decodeReminderNames, REMINDER_NAMES_KEY } from "../sw/reminder-names.ts";
import { CacheReminderNames, type CacheStorageLike } from "./cache-reminder-names.ts";

/** Cache Storage as the page and the worker share it: one named cache of request -> response. */
class MemoryCaches implements CacheStorageLike {
  readonly stores = new Map<string, Map<string, string>>();
  failing = false;
  /** When set, `open` waits for it: a slow device, so a `delete` can land in between. */
  gate: Promise<void> | null = null;

  async open(name: string) {
    if (this.gate) await this.gate;
    if (this.failing) throw new Error("SecurityError");
    const store = this.stores.get(name) ?? new Map<string, string>();
    this.stores.set(name, store);
    return {
      put: async (key: string, response: Response) => void store.set(key, await response.text()),
      match: async (key: string) => {
        const text = store.get(key);
        return text === undefined ? undefined : new Response(text);
      },
    };
  }

  async delete(name: string) {
    if (this.failing) throw new Error("SecurityError");
    return this.stores.delete(name);
  }

  stored(): ReadonlyMap<string, string> {
    const text = [...this.stores.values()][0]?.get(REMINDER_NAMES_KEY) ?? null;
    return decodeReminderNames(text);
  }
}

describe("CacheReminderNames", () => {
  it("leaves the visible commitments' names where the worker reads them", async () => {
    const caches = new MemoryCaches();
    const names = new CacheReminderNames(caches);
    await names.save([
      { commitmentId: "c-1", habitName: "Leer", privacy: "visible" },
      { commitmentId: "c-2", habitName: "Terapia", privacy: "private" },
    ]);
    expect(caches.stored()).toEqual(new Map([["c-1", "Leer"]]));
  });

  it("replaces the names on every save, and clear removes them all", async () => {
    const caches = new MemoryCaches();
    const names = new CacheReminderNames(caches);
    await names.save([{ commitmentId: "c-1", habitName: "Leer", privacy: "visible" }]);
    await names.save([{ commitmentId: "c-3", habitName: "Correr", privacy: "visible" }]);
    expect(caches.stored()).toEqual(new Map([["c-3", "Correr"]]));
    await names.clear();
    expect(caches.stores.size).toBe(0);
  });

  it("a sign-out right after a save still ends with no names (save and clear run in order)", async () => {
    const caches = new MemoryCaches();
    const names = new CacheReminderNames(caches);
    let release = () => {};
    caches.gate = new Promise((resolve) => {
      release = resolve;
    });
    const saving = names.save([{ commitmentId: "c-1", habitName: "Leer", privacy: "visible" }]);
    const clearing = names.clear();
    await Promise.resolve();
    caches.gate = null;
    release();
    await Promise.all([saving, clearing]);
    expect(caches.stored()).toEqual(new Map());
  });

  it("never rejects: no Cache Storage, or one that throws, just keeps the generic copy", async () => {
    const failing = new MemoryCaches();
    failing.failing = true;
    for (const names of [new CacheReminderNames(undefined), new CacheReminderNames(failing)]) {
      await expect(
        names.save([{ commitmentId: "c-1", habitName: "Leer", privacy: "visible" }]),
      ).resolves.toBeUndefined();
      await expect(names.clear()).resolves.toBeUndefined();
    }
  });
});
