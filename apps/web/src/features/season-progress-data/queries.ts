import { focusManager, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { usePactJoyApi } from "../../context/api-context.tsx";
import { useClock } from "../../context/clock-context.tsx";
import type {
  CommitmentProgress,
  MemberProgress,
  SeasonProgress,
  WeekSummary,
} from "../../ports/wire.ts";
import {
  commitmentProgressKey,
  memberProgressKey,
  progressKey,
  seasonProgressKey,
  weekSummaryKey,
} from "../../shared/query-keys.ts";
import { watchSeasonDay } from "./season-clock.ts";

/** The season's zone once a started view arrived; a season that has not started has none yet. */
const zoneOf = (
  view: SeasonProgress | MemberProgress | CommitmentProgress | WeekSummary | undefined,
) => (view === undefined || !("season" in view) ? undefined : view.season.timeZone);

/**
 * Keeps a mounted progress read true across a season-local day change, without waiting for focus,
 * a remount or a mutation (AC-PG-A05): it only refetches, nothing is computed here.
 */
function useSeasonDayRefresh(timeZone: string | undefined): void {
  const clock = useClock();
  const client = useQueryClient();
  useEffect(() => {
    if (timeZone === undefined) return;
    return watchSeasonDay(
      clock,
      timeZone,
      (check) => focusManager.subscribe((focused) => (focused ? check() : undefined)),
      () => void client.invalidateQueries({ queryKey: progressKey }),
    );
  }, [clock, client, timeZone]);
}

/**
 * The season progress reads. Each is recomputed by the server on every refetch (no optimistic
 * scoring, not persisted offline) and refreshed when the season-local day changes.
 */
export function useSeasonProgress(seasonId: string) {
  const api = usePactJoyApi();
  const query = useQuery({
    queryKey: seasonProgressKey(seasonId),
    queryFn: ({ signal }) => api.getSeasonProgress(seasonId, signal),
  });
  useSeasonDayRefresh(zoneOf(query.data));
  return query;
}

export function useMemberProgress(seasonId: string, memberId: string) {
  const api = usePactJoyApi();
  const query = useQuery({
    queryKey: memberProgressKey(seasonId, memberId),
    queryFn: ({ signal }) => api.getMemberProgress(seasonId, memberId, signal),
  });
  useSeasonDayRefresh(zoneOf(query.data));
  return query;
}

export function useCommitmentProgress(seasonId: string, commitmentId: string) {
  const api = usePactJoyApi();
  const query = useQuery({
    queryKey: commitmentProgressKey(seasonId, commitmentId),
    queryFn: ({ signal }) => api.getCommitmentProgress(seasonId, commitmentId, signal),
  });
  useSeasonDayRefresh(zoneOf(query.data));
  return query;
}

/** `weekIndex` is 0-based (the UI shows it + 1). */
export function useWeekSummary(seasonId: string, weekIndex: number) {
  const api = usePactJoyApi();
  const query = useQuery({
    queryKey: weekSummaryKey(seasonId, weekIndex),
    queryFn: ({ signal }) => api.getWeekSummary(seasonId, weekIndex, signal),
  });
  useSeasonDayRefresh(zoneOf(query.data));
  return query;
}
