import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePactJoyApi } from "../../context/api-context.tsx";
import type { SubmitReviewCommand } from "../../ports/pactjoy-api.ts";
import { progressKey, reviewKey, reviewsKey, stageKey, todayKey } from "../../shared/query-keys.ts";

/**
 * The owner's view of one review period. Read live (the summary is recomputed from Entries) and
 * read once per visit: it is dropped when the route closes, and a refetch never replaces a draft
 * the member is answering (the saved screen would lose what the server said when it saved).
 */
export function useReview(seasonId: string, periodIndex: number) {
  const api = usePactJoyApi();
  return useQuery({
    queryKey: reviewKey(seasonId, periodIndex),
    queryFn: ({ signal }) => api.getReview(seasonId, periodIndex, signal),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/**
 * After a review is saved or skipped: Today stops offering it and the progress reads refresh. The
 * review reads are marked stale WITHOUT refetching, so the open draft keeps what the member sees.
 * Awaited, so the next screen never shows the old Today.
 */
export async function invalidateReviewState(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: todayKey }),
    client.invalidateQueries({ queryKey: reviewsKey, refetchType: "none" }),
    client.invalidateQueries({ queryKey: progressKey }),
  ]);
}

export function useSubmitReview(seasonId: string, periodIndex: number) {
  const api = usePactJoyApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (cmd: SubmitReviewCommand) => api.submitReview(seasonId, periodIndex, cmd),
    onSettled: () => invalidateReviewState(client),
  });
}

/** "Ahora no" on the baseline offer: only period 0 can be skipped. */
export function useSkipBaseline(seasonId: string) {
  const api = usePactJoyApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.skipBaseline(seasonId),
    onSettled: () => invalidateReviewState(client),
  });
}

/** What Today says about reviews, through the same query Today uses (no second request). */
export function useReviewOffer() {
  const api = usePactJoyApi();
  const query = useQuery({ queryKey: todayKey, queryFn: ({ signal }) => api.getToday(signal) });
  const today = query.data;
  if (today === undefined || !("pendingReview" in today)) {
    return { pendingReview: null, baselineOffer: null };
  }
  return { pendingReview: today.pendingReview, baselineOffer: today.baselineOffer };
}

/** The derived stage of one of MY commitments; the badge asks only for the viewer's own. */
export function useCommitmentStage(seasonId: string, commitmentId: string, enabled: boolean) {
  const api = usePactJoyApi();
  return useQuery({
    queryKey: stageKey(seasonId, commitmentId),
    queryFn: ({ signal }) => api.getCommitmentStage(seasonId, commitmentId, signal),
    enabled,
  });
}
