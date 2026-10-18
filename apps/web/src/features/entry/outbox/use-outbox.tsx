import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import type { Connectivity } from "../../../ports/connectivity.ts";
import type { IdSource } from "../../../ports/ids.ts";
import { EMPTY_OUTBOX, type OutboxState, type OutboxStore } from "../../../ports/outbox-store.ts";
import type { Visibility } from "../../../ports/visibility.ts";
import { Outbox, type OutboxDeps } from "./outbox.ts";
import { startReplayTriggers } from "./triggers.ts";

const OutboxContext = createContext<Outbox | null>(null);

export interface OutboxProviderProps {
  /** The signed-in user; null while signed out, when there is no outbox at all. */
  readonly userId: string | null;
  readonly api: OutboxDeps["api"];
  readonly store: OutboxStore;
  readonly ids: IdSource;
  readonly connectivity: Connectivity;
  readonly visibility: Visibility;
  /** Called after a replay that changed anything; keep its identity stable. */
  readonly onReplayed: () => void;
  readonly children: ReactNode;
}

/**
 * One outbox per signed-in user, replaced when the user changes. It starts replaying as soon as it
 * exists (app start with a session) and stops when the user goes away.
 */
export function OutboxProvider({
  userId,
  api,
  store,
  ids,
  connectivity,
  visibility,
  onReplayed,
  children,
}: OutboxProviderProps) {
  const outbox = useMemo(
    () => (userId === null ? null : new Outbox({ api, store, userId, ids, onReplayed })),
    [userId, api, store, ids, onReplayed],
  );
  useEffect(() => {
    if (outbox === null) return;
    return startReplayTriggers({ outbox, connectivity, visibility });
  }, [outbox, connectivity, visibility]);
  return <OutboxContext.Provider value={outbox}>{children}</OutboxContext.Provider>;
}

/** The signed-in user's outbox, or null when signed out. */
export function useOutbox(): Outbox | null {
  return useContext(OutboxContext);
}

const NO_SUBSCRIPTION = () => () => undefined;

/** The outbox's items and notices, re-rendering when they change; empty while signed out. */
export function useOutboxState(): OutboxState {
  const outbox = useOutbox();
  return useSyncExternalStore(
    outbox === null ? NO_SUBSCRIPTION : (notify) => outbox.subscribe(notify),
    () => outbox?.snapshot() ?? EMPTY_OUTBOX,
  );
}
