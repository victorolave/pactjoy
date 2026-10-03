import { MutationCache, QueryClient } from "@tanstack/react-query";
import { todayKey } from "../shared/query-keys.ts";
import { toUiError } from "../shared/ui-error.ts";

const STALE_TIME_MS = 30_000;
const MAX_QUERY_RETRIES = 2;

/**
 * One client for the app. Queries retry only transient errors; mutations never retry (a record is
 * safe to retry only by the user, with the same clientRequestId). Every settled mutation
 * invalidates Today: the server recomputes, the client never guesses points (AC-R4).
 */
export function createQueryClient({
  retryQueries = true,
}: {
  /** Tests turn this off so a scripted failure surfaces at once instead of after backoff. */
  readonly retryQueries?: boolean;
} = {}): QueryClient {
  const client: QueryClient = new QueryClient({
    mutationCache: new MutationCache({
      onSettled: () => {
        void client.invalidateQueries({ queryKey: todayKey });
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
