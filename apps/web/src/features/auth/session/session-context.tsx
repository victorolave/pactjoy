import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AuthPort, Session } from "../../../ports/auth.ts";
import type { TokenStore } from "../../../ports/token-store.ts";
import type { SessionEvents } from "./session-events.ts";
import type { SessionManager } from "./session-manager.ts";

/** Why the user is signed out, when it was not their own choice. */
export type SessionNotice = "sessionExpired" | "accountDeleted";

export interface SessionApi {
  readonly session: Session | null;
  readonly notice: SessionNotice | null;
  requestCode(email: string): Promise<void>;
  /** Resolves once the session is stored. Rejects with the port's AuthError. */
  verifyCode(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;
  /** The server rejected the session (401 after one refresh): clear it without a remote call. */
  expire(): void;
  /**
   * The server deleted the account (ADR-0019): end the session here like `expire`, with its own
   * notice. There is no remote sign-out, because the user no longer exists.
   */
  accountDeleted(): void;
}

const SessionContext = createContext<SessionApi | null>(null);

/** How long a sign-out waits for `beforeSignOut` before it goes on anyway. */
const SIGN_OUT_GRACE_MS = 2_000;

/** Settles when `work` does or after the grace period, whichever is first; never rejects. */
function withinGrace(work: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const grace = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, SIGN_OUT_GRACE_MS);
  });
  return Promise.race([work.catch(() => undefined), grace]).finally(() => clearTimeout(timer));
}

export interface SessionProviderProps {
  readonly auth: AuthPort;
  readonly store: TokenStore;
  readonly manager: SessionManager;
  /** Runs whenever the session ends, so the app can drop data that belongs to it (query cache). */
  readonly onSessionEnd?: () => void;
  /** Lets code outside React (the API adapter) expire the session. */
  readonly expired?: SessionEvents;
  /**
   * Runs at the start of a sign-out, while the session can still call the API (the device's push
   * registration is removed here, ADR-0017). Best effort: a rejection never blocks the sign-out,
   * and the sign-out goes on after two seconds whatever it is still waiting for.
   */
  readonly beforeSignOut?: () => Promise<void>;
  /**
   * Runs once the account is deleted, for what only this device can still do (drop its push
   * subscription in the browser). Best effort and not awaited: a rejection is swallowed.
   */
  readonly onAccountDeleted?: () => Promise<void>;
  readonly children: ReactNode;
}

export function SessionProvider({
  auth,
  store,
  manager,
  onSessionEnd,
  expired,
  beforeSignOut,
  onAccountDeleted,
  children,
}: SessionProviderProps) {
  const [session, setSession] = useState<Session | null>(() => store.load());
  const [notice, setNotice] = useState<SessionNotice | null>(null);

  // Another tab refreshes or ends the session: follow it. Its sign out ends this tab's data too.
  const current = useRef(session);
  current.current = session;
  useEffect(
    () =>
      store.subscribe((next) => {
        const previous = current.current;
        setSession(next);
        // A sign out, or a different user, means the cached data is no longer this user's.
        if (next === null || (previous !== null && next.userId !== previous.userId)) {
          onSessionEnd?.();
        }
      }),
    [store, onSessionEnd],
  );

  const expire = useCallback(() => {
    // A late 401 of a request that outlived the session (after a sign out or the account deletion)
    // must not replace the notice that ended it. The ref is cleared here, not only on render, so
    // two calls in the same tick see the first one.
    if (current.current === null) return;
    store.clear();
    current.current = null;
    setNotice("sessionExpired");
    setSession(null);
    onSessionEnd?.();
  }, [store, onSessionEnd]);

  const accountDeleted = useCallback(() => {
    store.clear();
    current.current = null;
    setNotice("accountDeleted");
    setSession(null);
    onSessionEnd?.();
    onAccountDeleted?.().catch(() => undefined);
  }, [store, onSessionEnd, onAccountDeleted]);

  useEffect(() => expired?.onExpire(expire), [expired, expire]);

  const api = useMemo<SessionApi>(
    () => ({
      session,
      notice,
      requestCode: (email) => auth.requestCode(email),
      async verifyCode(email, code) {
        const next = await auth.verifyCode(email, code);
        store.save(next);
        setNotice(null);
        setSession(next);
      },
      async signOut() {
        if (beforeSignOut) await withinGrace(beforeSignOut());
        await manager.signOut();
        setNotice(null);
        setSession(null);
        onSessionEnd?.();
      },
      expire,
      accountDeleted,
    }),
    [auth, store, manager, onSessionEnd, beforeSignOut, expire, accountDeleted, session, notice],
  );

  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const api = useContext(SessionContext);
  if (api === null) throw new Error("useSession must be used inside a SessionProvider");
  return api;
}
