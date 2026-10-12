import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePactJoyApi } from "../../context/api-context.tsx";
import { ApiError } from "../../ports/api-error.ts";
import type { PauseDecision, RequestPauseCommand } from "../../ports/pactjoy-api.ts";
import {
  myCircleKey,
  pauseRequestsKey,
  progressKey,
  seasonsKey,
  todayKey,
} from "../../shared/query-keys.ts";

/**
 * The viewer's pause requests, the ones awaiting their answer, their budgets and the 30b
 * comparison. Not persisted offline (see `pauseRequestsKey`).
 */
export function useMyPauseRequests() {
  const api = usePactJoyApi();
  return useQuery({
    queryKey: pauseRequestsKey,
    queryFn: ({ signal }) => api.getMyPauseRequests(signal),
  });
}

/**
 * Today and the viewer's circle, under the keys the Today and Circle features use, so the pause
 * screens share their cache without importing those features (ADR-0012).
 */
export function useTodayForPause() {
  const api = usePactJoyApi();
  return useQuery({ queryKey: todayKey, queryFn: ({ signal }) => api.getToday(signal) });
}

export function useCircleForPause() {
  const api = usePactJoyApi();
  return useQuery({ queryKey: myCircleKey, queryFn: ({ signal }) => api.getMyCircle(signal) });
}

/**
 * After every pause mutation, settled or failed: a pause changes what Today shows, the score and
 * the standings, and a failure ("already decided") means the screen was stale. Awaited, so a
 * sheet never closes onto the old state.
 */
export async function invalidatePauseState(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: todayKey }),
    client.invalidateQueries({ queryKey: pauseRequestsKey }),
    client.invalidateQueries({ queryKey: progressKey }),
    client.invalidateQueries({ queryKey: seasonsKey }),
  ]);
}

/**
 * The server answers a lost race on a request with `ConcurrencyConflict` (D2), and nothing was
 * written, so one more attempt is safe and normally lands. A second conflict is shown.
 */
async function retryOnConflict<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError && error.code === "ConcurrencyConflict") return run();
    throw error;
  }
}

export function useRequestPause(seasonId: string) {
  const api = usePactJoyApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (cmd: RequestPauseCommand) =>
      retryOnConflict(() => api.requestPause(seasonId, cmd)),
    onSettled: () => invalidatePauseState(client),
  });
}

/** An approver's answer. It can flip while the request is pending (Q3). */
export function useRespondToPause() {
  const api = usePactJoyApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (args: { readonly id: string; readonly decision: PauseDecision }) =>
      retryOnConflict(() => api.respondToPause(args.id, args.decision)),
    onSettled: () => invalidatePauseState(client),
  });
}

export function useCancelPauseRequest() {
  const api = usePactJoyApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => retryOnConflict(() => api.cancelPauseRequest(id)),
    onSettled: () => invalidatePauseState(client),
  });
}

/** Resumes one Commitment of a request, or every one still running when no id is given. */
export function useResumePause() {
  const api = usePactJoyApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (args: { readonly id: string; readonly commitmentId?: string }) =>
      retryOnConflict(() => api.resumePause(args.id, args.commitmentId)),
    onSettled: () => invalidatePauseState(client),
  });
}
