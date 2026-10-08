import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import type {
  PersistedClient,
  Persister,
  PersistQueryClientProviderProps,
} from "@tanstack/react-query-persist-client";
import { todayKey } from "../shared/query-keys.ts";

export const STORAGE_KEY = "pactjoy.today-cache";
/** Offline reads show the last Today for at most a day. */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const THROTTLE_MS = 1000;
/** Bump for shape OR scoring semantics: v5 purges ended-clamped scores and old weekly series. */
export const CACHE_VERSION = "5";

/** The saved Today belongs to one user of one cache version: anything else is not restored. */
export const bustFor = (userId: string | null): string => `${CACHE_VERSION}:${userId ?? "anon"}`;

/** Reading the `localStorage` property itself can throw (blocked storage, some private modes). */
const defaultStorage = (): Storage | null => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

const NO_STORAGE: Persister = {
  persistClient: async () => {},
  restoreClient: async () => undefined,
  removeClient: async () => {},
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * A minimal shape check on top of the version buster: a running Today must carry what the screens
 * read without a guard (`points` on every row, `pointsToday` in the summary, `pendingYesterday`). The buster already drops
 * old copies; this keeps a copy that slipped past it from crashing the app. Pre-season states
 * also require the owned commitment list introduced by Lote 3.
 */
export function isCurrentToday(today: unknown): boolean {
  if (!isRecord(today)) return false;
  if (
    !["noCircle", "noSeason", "pactOpen", "notStarted", "active", "ended"].includes(
      String(today.state),
    )
  )
    return false;
  if (today.state === "pactOpen" || today.state === "notStarted")
    return Array.isArray(today.myCommitments);
  if (today.state !== "active" && today.state !== "ended") return true;
  const { rows, summary } = today;
  if (!Array.isArray(rows) || !isRecord(summary) || typeof summary.pointsToday !== "number") {
    return false;
  }
  return (
    Array.isArray(today.pendingYesterday) &&
    rows.every(
      (row) => isRecord(row) && isRecord(row.points) && "perOpportunityExact" in row.points,
    )
  );
}

const hasCurrentShape = (client: PersistedClient): boolean =>
  client.clientState.queries.every(
    (query) => query.queryKey[0] !== todayKey[0] || isCurrentToday(query.state.data),
  );

/** Restores through `persister`, but drops (and erases) a saved Today that fails {@link isCurrentToday}. */
function guarded(persister: Persister): Persister {
  return {
    ...persister,
    restoreClient: async () => {
      const client = await persister.restoreClient();
      if (client === undefined || hasCurrentShape(client)) return client;
      await persister.removeClient();
      return undefined;
    },
  };
}

/**
 * Persists the last Today in localStorage so it can be read offline (P1: reads only, no write queue).
 * Storage that is blocked or full never throws into the app: the cache is simply not kept.
 */
export function createTodayPersister(
  storage: Storage | null = defaultStorage(),
  { throttleMs = THROTTLE_MS }: { readonly throttleMs?: number } = {},
): Persister {
  if (storage === null) return NO_STORAGE;
  return guarded(
    createSyncStoragePersister({
      storage,
      key: STORAGE_KEY,
      throttleTime: throttleMs,
      retry: () => undefined,
    }),
  );
}

/** Only a Today that loaded is kept: no other query, no failure, no pending request. */
export function persistOptionsFor(
  persister: Persister,
  buster: string,
): PersistQueryClientProviderProps["persistOptions"] {
  return {
    persister,
    maxAge: MAX_AGE_MS,
    buster,
    dehydrateOptions: {
      // Writes are never queued or replayed (P1): a pending mutation must not survive a reload.
      shouldDehydrateMutation: () => false,
      shouldDehydrateQuery: (query) =>
        query.queryKey[0] === todayKey[0] && query.state.status === "success",
    },
  };
}
