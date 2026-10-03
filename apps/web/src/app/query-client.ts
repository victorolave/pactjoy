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
export function createQueryClient(): QueryClient {
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
        retry: (failureCount, error) =>
          failureCount < MAX_QUERY_RETRIES && toUiError(error).retryable,
      },
      mutations: { retry: 0 },
    },
  });
  return client;
}
