import { focusManager, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { usePactJoyApi } from "../../context/api-context.tsx";
import { useClock } from "../../context/clock-context.tsx";
import { progressKey, todayKey } from "../../shared/query-keys.ts";
import { seasonDate, watchSeasonDay } from "../season-progress-data/index.ts";

/** Today for the signed-in viewer: one read, recomputed by the server on every refetch. */
export function useToday() {
  const api = usePactJoyApi();
  const clock = useClock();
  const client = useQueryClient();
  const [, onDayChange] = useState(0);
  const query = useQuery({ queryKey: todayKey, queryFn: ({ signal }) => api.getToday(signal) });
  const zone = query.data && "timeZone" in query.data ? query.data.timeZone : undefined;
  useEffect(() => {
    if (zone === undefined) return;
    return watchSeasonDay(
      clock,
      zone,
      (check) => focusManager.subscribe((focused) => (focused ? check() : undefined)),
      () => {
        // Expire the banner even when the network fails and Today keeps its last response.
        onDayChange((day) => day + 1);
        void client.invalidateQueries({ queryKey: todayKey });
        void client.invalidateQueries({ queryKey: progressKey });
      },
    );
  }, [clock, client, zone]);
  return { ...query, localToday: zone === undefined ? null : seasonDate(clock.nowMs(), zone) };
}
