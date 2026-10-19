import type { TodayView } from "@pactjoy/app";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import type { Connectivity } from "../../../ports/connectivity.ts";
import type { ExclusiveLock } from "../../../ports/exclusive-lock.ts";
import type { IdSource } from "../../../ports/ids.ts";
import {
  EMPTY_OUTBOX,
  type OutboxState,
  type OutboxStore,
  type SentRecord,
} from "../../../ports/outbox-store.ts";
import type { Visibility } from "../../../ports/visibility.ts";
import { Outbox, type OutboxDeps } from "./outbox.ts";
import { overlayToday } from "./overlay.ts";
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
  /** Two tabs of the user take turns replaying (see `OutboxDeps.lock`). */
  readonly lock: ExclusiveLock;
  /** Who is signed in right now (see `OutboxDeps.currentUserId`); keep its identity stable. */
  readonly currentUserId: () => string | null;
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
  lock,
  currentUserId,
  children,
}: OutboxProviderProps) {
  const outbox = useMemo(
    () =>
      userId === null
        ? null
        : new Outbox({ api, store, userId, ids, onReplayed, lock, currentUserId }),
    [userId, api, store, ids, onReplayed, lock, currentUserId],
  );
  useEffect(() => {
    if (outbox === null) return;
    // Re-armed first: React may run this effect again on the same outbox (StrictMode).
    outbox.activate();
    const stop = startReplayTriggers({ outbox, connectivity, visibility });
    return () => {
      stop();
      // The user left or the tree went away: this outbox must never write again.
      outbox.dispose();
    };
  }, [outbox, connectivity, visibility]);
  return <OutboxContext.Provider value={outbox}>{children}</OutboxContext.Provider>;
}

/** The signed-in user's outbox, or null when signed out. */
export function useOutbox(): Outbox | null {
  return useContext(OutboxContext);
}

const NO_SUBSCRIPTION = () => () => undefined;

/** A `subscribe` whose identity only changes with the outbox: a new one makes React resubscribe. */
function useSubscribe(outbox: Outbox | null): (notify: () => void) => () => void {
  return useCallback(
    (notify) => (outbox === null ? NO_SUBSCRIPTION() : outbox.subscribe(notify)),
    [outbox],
  );
}

/** Whether a replay is sending queued items right now (the "syncing" line); false while signed out. */
export function useOutboxReplaying(): boolean {
  const outbox = useOutbox();
  return useSyncExternalStore(useSubscribe(outbox), () => outbox?.replaying() ?? false);
}

const NO_SENT: readonly SentRecord[] = [];

/**
 * The server's Today with what is waiting on the phone laid over it, plus the records that were
 * sent but may not be in this fetch yet (they stay laid over it until a fetch that started after
 * their send has resolved, so the row never looks open in between and never keeps a phantom entry
 * afterwards). `fetchStartedAt` is the `tick()` the data's fetch started at.
 */
export function useOverlayToday(
  data: TodayView,
  fetchStartedAt: number | null,
): ReturnType<typeof overlayToday> {
  const outbox = useOutbox();
  const { items } = useOutboxState();
  const sent = useSyncExternalStore(useSubscribe(outbox), () => outbox?.sentRecords() ?? NO_SENT);
  useEffect(() => {
    // A restored copy (null) was fetched in an earlier session: it settles nothing.
    if (outbox === null || fetchStartedAt === null) return;
    outbox.acknowledge(fetchStartedAt);
  }, [outbox, fetchStartedAt]);
  return useMemo(() => overlayToday(data, items, sent), [data, items, sent]);
}

/** The outbox's items and notices, re-rendering when they change; empty while signed out. */
export function useOutboxState(): OutboxState {
  const outbox = useOutbox();
  return useSyncExternalStore(useSubscribe(outbox), () => outbox?.snapshot() ?? EMPTY_OUTBOX);
}
