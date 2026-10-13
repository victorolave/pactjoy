import { useQuery } from "@tanstack/react-query";
import { usePactJoyApi } from "../../context/api-context.tsx";
import { habitsKey, profileSummaryKey, seasonHistoryKey } from "../../shared/query-keys.ts";

/**
 * The viewer's own habits, read through the API port and the shared key (profile reaches no other
 * feature). The graduated ones are the Perfil section; nobody else's habits are ever listed.
 */
export function useMyHabits() {
  const api = usePactJoyApi();
  return useQuery({ queryKey: habitsKey, queryFn: ({ signal }) => api.listHabits(signal) });
}

/** The closed seasons of the viewer's circle in which they held a commitment, newest first. */
export function useSeasonHistory() {
  const api = usePactJoyApi();
  return useQuery({
    queryKey: seasonHistoryKey,
    queryFn: ({ signal }) => api.getSeasonHistory(signal),
  });
}

/**
 * The viewer's pooled consistency and their non-graduated habits with the derived stage. Always
 * fresh (`staleTime: 0`) and not persisted: the stage and the figures move with every entry.
 */
export function useProfileSummary() {
  const api = usePactJoyApi();
  return useQuery({
    queryKey: profileSummaryKey,
    queryFn: ({ signal }) => api.getProfileSummary(signal),
    staleTime: 0,
  });
}
