import type { DeviceKey, DeviceStore } from "../ports/device-store.ts";

const PREFIX = "pactjoy.device.";
const SESSION_KEYS: readonly DeviceKey[] = ["nameDraft"];

/** Reading the `localStorage` property itself can throw (blocked storage, some private modes). */
const defaultStorage = (): Storage | null => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

/**
 * Device flags and the name draft in localStorage. When storage is blocked or full, the values
 * live in memory for this tab and nothing throws. Not secret data, so no encryption.
 */
export class LocalStorageDeviceStore implements DeviceStore {
  readonly #storage: Storage | null;
  readonly #memory = new Map<DeviceKey, string>();

  constructor(storage: Storage | null = defaultStorage()) {
    this.#storage = storage;
  }

  get(key: DeviceKey): string | null {
    try {
      // A quota-full or old Safari private storage reads fine but drops writes: fall back to memory.
      const stored = this.#storage?.getItem(PREFIX + key) ?? null;
      if (stored !== null) return stored;
    } catch {
      // Fall through to the in-memory copy.
    }
    return this.#memory.get(key) ?? null;
  }

  set(key: DeviceKey, value: string): void {
    this.#memory.set(key, value);
    try {
      this.#storage?.setItem(PREFIX + key, value);
    } catch {
      // Quota or blocked storage: the value lives in memory for this tab.
    }
  }

  remove(key: DeviceKey): void {
    this.#memory.delete(key);
    try {
      this.#storage?.removeItem(PREFIX + key);
    } catch {
      // Nothing to remove if storage is unavailable.
    }
  }

  clearSession(): void {
    for (const key of SESSION_KEYS) this.remove(key);
  }
}
