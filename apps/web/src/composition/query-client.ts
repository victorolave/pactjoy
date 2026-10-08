import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { progressKey, todayKey } from "../shared/query-keys.ts";
import { toUiError } from "../shared/ui-error.ts";

const STALE_TIME_MS = 30_000;
const MAX_QUERY_RETRIES = 2;

/**
 * One client for the app. Queries retry only transient errors; mutations never retry (a record is
 * safe to retry only by the user, with the same clientRequestId). Every settled mutation
 * invalidates Today and the season progress reads, even after the screen that started it
 * unmounted: the server recomputes, the client never guesses points (AC-R4, AC-PG-A03).
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
      onSettled: () => {
        void client.invalidateQueries({ queryKey: todayKey });
        void client.invalidateQueries({ queryKey: progressKey });
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
      // "always": offline a write fails at once with NetworkError instead of pausing and queueing
      // itself to run later (P1: no write queue).
      mutations: { retry: 0, networkMode: "always" },
    },
  });
  return client;
}
