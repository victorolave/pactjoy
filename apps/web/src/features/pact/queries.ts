import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePactJoyApi } from "../../context/api-context.tsx";
import type { CreateSeasonCommand } from "../../ports/pactjoy-api.ts";
import { habitsKey, myCircleKey, seasonKey, todayKey } from "../../shared/query-keys.ts";

/** The viewer's active circle and current season. */
export function useCurrentCircle() {
  const api = usePactJoyApi();
  return useQuery({
    queryKey: myCircleKey,
    queryFn: ({ signal }) => api.getMyCircle(signal),
  });
}

/** Fetches a season by its id. */
export function useSeason(seasonId: string | undefined) {
  const api = usePactJoyApi();
  return useQuery({
    queryKey: seasonId ? seasonKey(seasonId) : ["season", "none"],
    queryFn: ({ signal }) => {
      if (!seasonId) throw new Error("seasonId required");
      return api.getSeason(seasonId, signal);
    },
    enabled: Boolean(seasonId),
  });
}

/** Lists the caller's own habits. */
export function useHabits() {
  const api = usePactJoyApi();
  return useQuery({
    queryKey: habitsKey,
    queryFn: ({ signal }) => api.listHabits(signal),
  });
}

/**
 * Creates a new season in the circle. Invalidates today, circle and the new season on settle
 * (D5, WC-R10).
 */
export function useCreateSeason() {
  const api = usePactJoyApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      circleId,
      input,
    }: {
      readonly circleId: string;
      readonly input: CreateSeasonCommand;
    }) => api.createSeason(circleId, input),
    onSettled: async (data) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: todayKey }),
        client.invalidateQueries({ queryKey: myCircleKey }),
        ...(data ? [client.invalidateQueries({ queryKey: seasonKey(data.id) })] : []),
      ]);
    },
  });
}

/** Removes a commitment from a season. */
export function useRemoveCommitment() {
  const api = usePactJoyApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      seasonId,
      commitmentId,
    }: {
      readonly seasonId: string;
      readonly commitmentId: string;
    }) => api.removeCommitment(seasonId, commitmentId),
    onSuccess: (data, { seasonId }) => {
      client.setQueryData(seasonKey(seasonId), data);
    },
    onSettled: async (_data, _err, { seasonId }) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: seasonKey(seasonId) }),
        client.invalidateQueries({ queryKey: todayKey }),
        client.invalidateQueries({ queryKey: myCircleKey }),
      ]);
    },
  });
}
