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
import type { AuthPort, Session } from "../../ports/auth.ts";
import type { TokenStore } from "../../ports/token-store.ts";
import type { SessionEvents } from "./session-events.ts";
import type { SessionManager } from "./session-manager.ts";

/** Why the user is signed out, when it was not their own choice. */
export type SessionNotice = "sessionExpired";

export interface SessionApi {
  readonly session: Session | null;
  readonly notice: SessionNotice | null;
  requestCode(email: string): Promise<void>;
  /** Resolves once the session is stored. Rejects with the port's AuthError. */
  verifyCode(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;
  /** The server rejected the session (401 after one refresh): clear it without a remote call. */
  expire(): void;
}

const SessionContext = createContext<SessionApi | null>(null);

export interface SessionProviderProps {
  readonly auth: AuthPort;
  readonly store: TokenStore;
  readonly manager: SessionManager;
  /** Runs whenever the session ends, so the app can drop data that belongs to it (query cache). */
  readonly onSessionEnd?: () => void;
  /** Lets code outside React (the API adapter) expire the session. */
  readonly expired?: SessionEvents;
  readonly children: ReactNode;
}

export function SessionProvider({
  auth,
  store,
  manager,
  onSessionEnd,
  expired,
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
    store.clear();
    setNotice("sessionExpired");
    setSession(null);
    onSessionEnd?.();
  }, [store, onSessionEnd]);

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
        await manager.signOut();
        setNotice(null);
        setSession(null);
        onSessionEnd?.();
      },
      expire,
    }),
    [auth, store, manager, onSessionEnd, expire, session, notice],
  );

  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const api = useContext(SessionContext);
  if (api === null) throw new Error("useSession must be used inside a SessionProvider");
  return api;
}
