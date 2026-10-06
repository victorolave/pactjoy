import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePactJoyApi } from "../../context/api-context.tsx";
import type { CreateSeasonCommand } from "../../ports/pactjoy-api.ts";
import { myCircleKey, seasonKey, todayKey } from "../../shared/query-keys.ts";

/** The viewer's active circle and current season. */
export function useCurrentCircle() {
  const api = usePactJoyApi();
  return useQuery({
    queryKey: myCircleKey,
    queryFn: ({ signal }) => api.getMyCircle(signal),
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
