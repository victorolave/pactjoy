import type { CircleId } from "../shared/ids.ts";

/**
 * Whether a circle currently has a season blocking new joins (A2, B1, B11).
 * Joining is allowed whenever the circle has NO season *in progress*: that
 * covers a circle that never had a season (`"noSeason"`), one whose last
 * season is over and no new one has started yet (`"closed"`, between
 * seasons), and a season whose pact is still open (`"pactOpen"`). Joining
 * is blocked only while a season is `"active"` (pact closed, mid-season) --
 * see `sdd/app-foundation/design-decisions-b11`.
 *
 * This is a narrow seam, not the real `Season` aggregate: `SeasonGateStatus`
 * mirrors S4's future `SeasonStatus` (`"pactOpen" | "active" | "closed"`)
 * plus the `"noSeason"` sentinel for "no season row exists yet". Whichever
 * slice wires the real `seasons` repository into `Repositories` should also
 * satisfy (or replace) this interface instead of maintaining a second,
 * parallel season concept here.
 */
export type SeasonGateStatus = "noSeason" | "pactOpen" | "closed" | "active";

export interface SeasonGateReader {
  statusForCircle(circleId: CircleId): Promise<SeasonGateStatus>;
}

/** Joining is blocked only while a season is active -- pact closed, mid-season (A2, B11). */
export function canJoinCircle(status: SeasonGateStatus): boolean {
  return status !== "active";
}
