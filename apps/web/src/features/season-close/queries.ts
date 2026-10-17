import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePactJoyApi } from "../../context/api-context.tsx";
import type { SubmitClosureCommand } from "../../ports/pactjoy-api.ts";
import {
  habitsKey,
  myCircleKey,
  progressKey,
  seasonCloseKey,
  seasonKey,
  seasonResultsKey,
  seasonsKey,
  todayKey,
} from "../../shared/query-keys.ts";

/** What Today says about the end of the season, through the query Today itself uses (no second request). */
export function useSeasonCloseOffer() {
  const api = usePactJoyApi();
  const query = useQuery({ queryKey: todayKey, queryFn: ({ signal }) => api.getToday(signal) });
  const today = query.data;
  if (today === undefined || !("seasonClose" in today)) return null;
  return {
    seasonId: today.season.id,
    close: today.seasonClose,
    pendingReview: today.pendingReview,
  };
}

/**
 * The owner's final figures. Read live (recomputed from Entries) and read once per visit: it is
 * dropped when the route closes, and a refetch never replaces the decisions the member is making.
 */
export function useSeasonResults(seasonId: string) {
  const api = usePactJoyApi();
  return useQuery({
    queryKey: seasonResultsKey(seasonId),
    queryFn: ({ signal }) => api.getSeasonResults(seasonId, signal),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/**
 * After the closure is saved: Today, the circle, the habits (a graduated one leaves the list), the
 * season reads and the progress reads are refreshed, and the history and carry-over are marked
 * stale. The results are marked stale WITHOUT refetching, so the open flow keeps what the member
 * is seeing. Awaited, so the next screen never shows the old state.
 */
export async function invalidateCloseState(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: todayKey }),
    client.invalidateQueries({ queryKey: myCircleKey }),
    client.invalidateQueries({ queryKey: habitsKey }),
    client.invalidateQueries({ queryKey: seasonsKey }),
    client.invalidateQueries({ queryKey: progressKey }),
    client.invalidateQueries({ queryKey: seasonCloseKey, refetchType: "none" }),
  ]);
}

export function useSubmitClosure(seasonId: string) {
  const api = usePactJoyApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (cmd: SubmitClosureCommand) => api.submitSeasonClosure(seasonId, cmd),
    onSettled: () => invalidateCloseState(client),
  });
}

/**
 * Whether the circle may open its next season (37b): the season closed, or a week went by since its
 * last day. Read through the circle query the Circle tab uses; `false` until it answers.
 */
export function useCanOpenNextSeason(seasonClosedNow: boolean): boolean {
  const api = usePactJoyApi();
  const query = useQuery({
    queryKey: myCircleKey,
    queryFn: ({ signal }) => api.getMyCircle(signal),
  });
  if (seasonClosedNow) return true;
  const data = query.data;
  if (data === undefined) return false;
  return data.season === null || data.season.nextSeasonOpen;
}

/**
 * Who will read a graduation in the circle's activity, and whether a habit is private (38b,
 * ADR-0018). Read through the circle and season queries the other screens use, never their
 * features. While either has not answered, a commitment counts as private: the copy then promises
 * less (it never claims the habit is named).
 */
export function useGraduationAudience(seasonId: string): {
  readonly viewerName: string | null;
  readonly peers: readonly string[];
  readonly isPrivate: (commitmentId: string) => boolean;
} {
  const api = usePactJoyApi();
  const circle = useQuery({
    queryKey: myCircleKey,
    queryFn: ({ signal }) => api.getMyCircle(signal),
  });
  const season = useQuery({
    queryKey: seasonKey(seasonId),
    queryFn: ({ signal }) => api.getSeason(seasonId, signal),
  });
  const members = circle.data?.circle?.members ?? [];
  const known = season.data?.commitments;
  return {
    viewerName: members.find((member) => member.isYou)?.displayName ?? null,
    peers: members.filter((member) => !member.isYou).map((member) => member.displayName),
    isPrivate: (commitmentId) => {
      const commitment = known?.find((candidate) => candidate.id === commitmentId);
      return (
        commitment === undefined || commitment.kind !== "detail" || commitment.privacy !== "visible"
      );
    },
  };
}

/** Reads the results again, for a closure another device (or a lost race) already saved. */
export function useRefetchResults(seasonId: string): () => Promise<void> {
  const client = useQueryClient();
  return async () => {
    await client.refetchQueries({ queryKey: seasonResultsKey(seasonId) });
  };
}
