import { EMPTY_OUTBOX, type OutboxState, type OutboxStore } from "../ports/outbox-store.ts";

/** An in-memory `OutboxStore` for tests. Like the real one, its own writes do not notify. */
export class MemoryOutboxStore implements OutboxStore {
  readonly #states = new Map<string, OutboxState>();
  readonly #listeners = new Set<() => void>();
  /** How many times `clearAll` ran (a sign-out or an account deletion). */
  clears = 0;

  load(userId: string): OutboxState {
    return this.#states.get(userId) ?? EMPTY_OUTBOX;
  }

  save(userId: string, state: OutboxState): void {
    this.#states.set(userId, state);
  }

  clearAll(): void {
    this.clears += 1;
    this.#states.clear();
    for (const listener of [...this.#listeners]) listener();
  }

  clearExcept(userId: string): void {
    for (const key of [...this.#states.keys()]) if (key !== userId) this.#states.delete(key);
    for (const listener of [...this.#listeners]) listener();
  }

  subscribe(onChange: () => void): () => void {
    this.#listeners.add(onChange);
    return () => this.#listeners.delete(onChange);
  }

  /** How many subscriptions are open (an outbox that was never activated holds none). */
  get listenerCount(): number {
    return this.#listeners.size;
  }

  /** Simulates another tab writing this user's state. */
  emitExternal(userId: string, state: OutboxState): void {
    this.#states.set(userId, state);
    for (const listener of [...this.#listeners]) listener();
  }
}
