/**
 * A one-way signal from outside React (the API adapter's `onUnauthorized`) to the session
 * provider, which owns the session state.
 */
export interface SessionEvents {
  /** The server rejected the session for good. */
  expire(): void;
  /** Returns the unsubscribe function. */
  onExpire(listener: () => void): () => void;
}

export function createSessionEvents(): SessionEvents {
  const listeners = new Set<() => void>();
  return {
    expire() {
      for (const listener of [...listeners]) listener();
    },
    onExpire(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
