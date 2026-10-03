import { AuthError, type AuthPort, type Session } from "../../ports/auth.ts";
import type { Clock } from "../../ports/clock.ts";
import type { TokenStore } from "../../ports/token-store.ts";

/** Refresh when fewer than this many seconds remain on the access token. */
const REFRESH_WINDOW_SECONDS = 60;

type RefreshOutcome =
  | { readonly status: "ok"; readonly token: string }
  | { readonly status: "transient" }
  | { readonly status: "rejected" };

/**
 * Owns the session lifecycle: serves a fresh access token, refreshes ahead of expiry with a
 * single in-flight request (refresh tokens rotate, so two parallel refreshes would invalidate each
 * other), and clears the session only when the server definitively rejects the refresh token (AU-R4).
 */
export class SessionManager {
  readonly #auth: AuthPort;
  readonly #store: TokenStore;
  readonly #clock: Clock;
  #inflight: Promise<RefreshOutcome> | null = null;

  constructor(auth: AuthPort, store: TokenStore, clock: Clock) {
    this.#auth = auth;
    this.#store = store;
    this.#clock = clock;
  }

  async getAccessToken(): Promise<string | null> {
    const session = this.#store.load();
    if (session === null) return null;
    const secondsLeft = session.expiresAt - this.#clock.nowMs() / 1000;
    if (secondsLeft >= REFRESH_WINDOW_SECONDS) return session.accessToken;

    const outcome = await this.#refresh();
    if (outcome.status === "ok") return outcome.token;
    // Transient failure: keep the session and serve the old token only while it is still valid.
    if (outcome.status === "transient" && secondsLeft > 0) return session.accessToken;
    return null;
  }

  /** Refreshes now (after a 401). Resolves the new token, or null when it cannot. */
  async forceRefresh(): Promise<string | null> {
    const outcome = await this.#refresh();
    return outcome.status === "ok" ? outcome.token : null;
  }

  async signOut(): Promise<void> {
    const session = this.#store.load();
    this.#store.clear();
    if (session !== null) await this.#auth.signOut(session.accessToken);
  }

  #refresh(): Promise<RefreshOutcome> {
    if (this.#inflight !== null) return this.#inflight;
    const session = this.#store.load();
    if (session === null) return Promise.resolve({ status: "rejected" });
    const run = this.#run(session).finally(() => {
      this.#inflight = null;
    });
    this.#inflight = run;
    return run;
  }

  async #run(session: Session): Promise<RefreshOutcome> {
    try {
      const next = await this.#auth.refresh(session.refreshToken);
      this.#store.save(next);
      return { status: "ok", token: next.accessToken };
    } catch (error) {
      // Only a definitive rejection ends the session. Network, 429 and 5xx keep it: a blip must
      // not sign the user out.
      if (error instanceof AuthError && error.code === "InvalidSession") {
        this.#store.clear();
        return { status: "rejected" };
      }
      return { status: "transient" };
    }
  }
}
