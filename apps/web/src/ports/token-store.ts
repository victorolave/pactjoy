import type { Session } from "./auth.ts";

export interface TokenStore {
  load(): Session | null;
  save(session: Session): void;
  clear(): void;
  /** Notified when ANOTHER tab changes the session (refresh tokens rotate). Returns unsubscribe. */
  subscribe(onChange: (session: Session | null) => void): () => void;
}
