import { EMPTY_OUTBOX, type OutboxState, type OutboxStore } from "../ports/outbox-store.ts";

const PREFIX = "pactjoy.outbox.v1:";

/** Reading the `localStorage` property itself can throw (blocked storage, some private modes). */
const defaultStorage = (): Storage | null => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

/** The part of `window` the `storage` event subscription needs. */
export interface StorageEvents {
  addEventListener(type: "storage", listener: (event: Event) => void): void;
  removeEventListener(type: "storage", listener: (event: Event) => void): void;
}

const defaultEvents = (): StorageEvents | null => (typeof window === "undefined" ? null : window);

const isState = (value: unknown): value is OutboxState => {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Partial<OutboxState>;
  return state.v === 1 && Array.isArray(state.items) && Array.isArray(state.notices);
};

/**
 * The outbox in localStorage, one key per user. When storage is blocked or full, the state lives
 * in memory for this tab and nothing throws. The queue holds the member's own entries (habit names,
 * values, notes), so it is erased with the session (OE-R6), never kept for the next person.
 */
export class LocalStorageOutboxStore implements OutboxStore {
  readonly #storage: Storage | null;
  readonly #events: StorageEvents | null;
  /** Only holds a user's state while storage refused to take it. */
  readonly #memory = new Map<string, OutboxState>();
  readonly #listeners = new Set<() => void>();

  constructor(
    storage: Storage | null = defaultStorage(),
    events: StorageEvents | null = defaultEvents(),
  ) {
    this.#storage = storage;
    this.#events = events;
  }

  load(userId: string): OutboxState {
    try {
      const raw = this.#storage?.getItem(PREFIX + userId) ?? null;
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        return isState(parsed) ? parsed : EMPTY_OUTBOX;
      }
    } catch {
      // Unreadable or corrupt: fall through to the in-memory copy, if any.
    }
    return this.#memory.get(userId) ?? EMPTY_OUTBOX;
  }

  save(userId: string, state: OutboxState): void {
    const empty = state.items.length === 0 && state.notices.length === 0;
    if (empty) this.#memory.delete(userId);
    else this.#memory.set(userId, state);
    try {
      if (empty) this.#storage?.removeItem(PREFIX + userId);
      else if (this.#storage !== null) {
        this.#storage.setItem(PREFIX + userId, JSON.stringify(state));
        // Stored: the memory copy would only go stale (another tab may clear the key).
        this.#memory.delete(userId);
      }
    } catch {
      // Quota or blocked storage: the state stays in memory for this tab.
    }
  }

  clearAll(): void {
    this.#memory.clear();
    try {
      const storage = this.#storage;
      const keys: string[] = [];
      for (let index = 0; storage !== null && index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(PREFIX)) keys.push(key);
      }
      for (const key of keys) storage?.removeItem(key);
    } catch {
      // Nothing more to remove if storage is unavailable.
    }
    // The browser only fires `storage` in OTHER tabs: tell this tab's outbox it holds nothing now.
    for (const listener of [...this.#listeners]) listener();
  }

  subscribe(onChange: () => void): () => void {
    this.#listeners.add(onChange);
    const events = this.#events;
    // `key` is null when another tab called `storage.clear()`.
    const listener = (event: Event) => {
      const { key } = event as StorageEvent;
      if (key === null || key.startsWith(PREFIX)) onChange();
    };
    events?.addEventListener("storage", listener);
    return () => {
      this.#listeners.delete(onChange);
      events?.removeEventListener("storage", listener);
    };
  }
}
