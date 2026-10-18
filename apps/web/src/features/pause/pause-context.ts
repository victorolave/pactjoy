import { addDays } from "../../shared/date.ts";
import { memberName } from "../../shared/member-name.ts";
import { useCircleForPause, useMyPauseRequests, useTodayForPause } from "./queries.ts";

const DAYS_PER_WEEK = 7;

export interface PausableCommitment {
  readonly id: string;
  readonly habitName: string;
  readonly isPrivate: boolean;
}

export interface PauseSeason {
  readonly seasonId: string;
  readonly timeZone: string;
  /** The viewer's today, in the season's zone. */
  readonly today: string;
  readonly lastDay: string;
  readonly commitments: readonly PausableCommitment[];
}

/**
 * What the pause screens need to know about the viewer's running season, read through the same
 * cache entries Today and the Circle tab use (no feature import, only the port).
 *
 * `season` is `null` when there is nothing to pause (no circle, no running season, season ended).
 */
export function usePauseContext() {
  const today = useTodayForPause();
  const circle = useCircleForPause();
  const requests = useMyPauseRequests();

  const view = today.data;
  const season: PauseSeason | null =
    view?.state === "active" && view.season.actualStart !== null
      ? {
          seasonId: view.season.id,
          timeZone: view.timeZone,
          today: view.today,
          lastDay: addDays(view.season.actualStart, view.season.lengthWeeks * DAYS_PER_WEEK - 1),
          commitments: view.rows.map((row) => ({
            id: row.commitmentId,
            habitName: row.habitName,
            isPrivate: row.privacy === "private",
          })),
        }
      : null;

  const members = circle.data?.circle?.members ?? [];
  return {
    loading: today.isPending,
    failed: today.isError && view === undefined,
    retry: () => void today.refetch(),
    season,
    /** Everyone who answers a request: the other active members. */
    approverNames: members
      .filter((member) => !member.isYou)
      .map((member) => memberName(member.displayName)),
    /** Days left per Commitment; absent until the read model arrives. */
    remainingDays: new Map(
      (requests.data?.budgets ?? []).map((budget) => [budget.commitmentId, budget.remainingDays]),
    ),
    budgetsKnown: requests.data !== undefined,
  };
}
