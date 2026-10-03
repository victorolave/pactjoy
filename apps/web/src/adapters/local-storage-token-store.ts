import type { Session } from "../ports/auth.ts";
import type { TokenStore } from "../ports/token-store.ts";

export const STORAGE_KEY = "pactjoy.session";

const isSession = (value: unknown): value is Session => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.accessToken === "string" &&
    typeof candidate.refreshToken === "string" &&
    typeof candidate.expiresAt === "number" &&
    typeof candidate.userId === "string" &&
    (typeof candidate.email === "string" || candidate.email === null)
  );
};

/** Reading the `localStorage` property itself can throw (blocked storage, some private modes). */
const defaultStorage = (): Storage | null => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

/**
 * Session in localStorage. Risk: XSS can read it (ADR-0012); mitigations are no
 * dangerouslySetInnerHTML and a CSP later. Storage failures (quota, Safari private mode) never
 * throw and never clear a session: the app keeps working in memory for that tab.
 */
export class LocalStorageTokenStore implements TokenStore {
  readonly #storage: Storage | null;
  /** Fallback for this tab when storage is unavailable, so sign-in still works. */
  #memory: Session | null = null;

  constructor(storage: Storage | null = defaultStorage()) {
    this.#storage = storage;
  }

  load(): Session | null {
    try {
      if (this.#storage === null) return this.#memory;
      const raw = this.#storage.getItem(STORAGE_KEY);
      if (raw === null) return null;
      const parsed: unknown = JSON.parse(raw);
      return isSession(parsed) ? parsed : null;
    } catch {
      return this.#memory;
    }
  }

  save(session: Session): void {
    this.#memory = session;
    try {
      this.#storage?.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      // Quota or blocked storage: the session simply is not persisted.
    }
  }

  clear(): void {
    this.#memory = null;
    try {
      this.#storage?.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to clear if storage is unavailable.
    }
  }

  subscribe(onChange: (session: Session | null) => void): () => void {
    const listener = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) onChange(this.load());
    };
    window.addEventListener("storage", listener);
    return () => window.removeEventListener("storage", listener);
  }
}
