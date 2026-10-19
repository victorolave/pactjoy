import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { progressKey, reactionMutationKey, socialKey, todayKey } from "../shared/query-keys.ts";
import { toUiError } from "../shared/ui-error.ts";

const STALE_TIME_MS = 30_000;
const MAX_QUERY_RETRIES = 2;

/**
 * One client for the app. Queries retry only transient errors; mutations never retry (a record is
 * safe to retry only by the user, with the same clientRequestId). Every settled mutation
 * invalidates Today, the season progress reads and the circle feed, even after the screen that started it
 * unmounted: the server recomputes, the client never guesses points (AC-R4, AC-PG-A03). The feed
 * alone waits while a reaction is still in flight.
 */
export function createQueryClient({
  retryQueries = true,
}: {
  /** Tests turn this off so a scripted failure surfaces at once instead of after backoff. */
  readonly retryQueries?: boolean;
} = {}): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onSuccess: (_data, query) => {
        // Weekly series can change scores after grace or a live recomputation, even off Today.
        if (query.queryKey[0] === progressKey[0] && query.queryKey[1] === "season") {
          void client.invalidateQueries({ queryKey: todayKey });
        }
      },
    }),
    mutationCache: new MutationCache({
      onSettled: (_data, _error, _variables, _context, mutation) => {
        void client.invalidateQueries({ queryKey: todayKey });
        void client.invalidateQueries({ queryKey: progressKey });
        // The circle feed is derived from entries, pauses and closures (ADR-0018). While another
        // reaction is in flight a read would come from before its write and erase its optimistic
        // chip, so the feed waits: the last reaction to settle refreshes it.
        const reacting = client
          .getMutationCache()
          .findAll({ mutationKey: reactionMutationKey, status: "pending" })
          .some((other) => other !== mutation);
        if (!reacting) void client.invalidateQueries({ queryKey: socialKey });
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME_MS,
        refetchOnWindowFocus: true,
        retry: retryQueries
          ? (failureCount, error) => failureCount < MAX_QUERY_RETRIES && toUiError(error).retryable
          : false,
      },
      // "always": a write runs (and fails with NetworkError) at once instead of TanStack pausing it
      // and queueing it for later. Entry writes are queued by the outbox, which decides before the
      // request (ADR-0012 addendum); TanStack mutations are never dehydrated or replayed.
      mutations: { retry: 0, networkMode: "always" },
    },
  });
  return client;
}
