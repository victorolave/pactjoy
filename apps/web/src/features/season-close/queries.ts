import { useQuery } from "@tanstack/react-query";
import { usePactJoyApi } from "../../context/api-context.tsx";
import { todayKey } from "../../shared/query-keys.ts";

/** What Today says about the end of the season, through the query Today itself uses (no second request). */
export function useSeasonCloseOffer() {
  const api = usePactJoyApi();
  const query = useQuery({ queryKey: todayKey, queryFn: ({ signal }) => api.getToday(signal) });
  const today = query.data;
  if (today === undefined || !("seasonClose" in today)) return null;
  return { seasonId: today.season.id, close: today.seasonClose };
}
