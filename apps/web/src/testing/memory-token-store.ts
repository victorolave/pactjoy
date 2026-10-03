import type { Session } from "../ports/auth.ts";
import type { TokenStore } from "../ports/token-store.ts";

export class MemoryTokenStore implements TokenStore {
  #session: Session | null;
  readonly #listeners = new Set<(session: Session | null) => void>();

  constructor(session: Session | null = null) {
    this.#session = session;
  }

  load(): Session | null {
    return this.#session;
  }

  save(session: Session): void {
    this.#session = session;
  }

  clear(): void {
    this.#session = null;
  }

  subscribe(onChange: (session: Session | null) => void): () => void {
    this.#listeners.add(onChange);
    return () => this.#listeners.delete(onChange);
  }

  /** Simulates another tab writing the session. */
  emitExternal(session: Session | null): void {
    this.#session = session;
    for (const listener of this.#listeners) listener(session);
  }
}
