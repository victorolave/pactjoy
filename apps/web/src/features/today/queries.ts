import { useQuery } from "@tanstack/react-query";
import { usePactJoyApi } from "../../context/api-context.tsx";
import { todayKey } from "../../shared/query-keys.ts";

/** Today for the signed-in viewer: one read, recomputed by the server on every refetch. */
export function useToday() {
  const api = usePactJoyApi();
  return useQuery({ queryKey: todayKey, queryFn: ({ signal }) => api.getToday(signal) });
}
