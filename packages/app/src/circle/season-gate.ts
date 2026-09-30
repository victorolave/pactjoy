/**
 * Whether a circle currently has a season blocking new joins (A2, B1, B11).
 * Joining is allowed whenever the circle has NO season *in progress*: that
 * covers a circle that never had a season (`"noSeason"`), one whose last
 * season is over and no new one has started yet (`"closed"`, between
 * seasons), and a season whose pact is still open (`"pactOpen"`). Joining
 * is blocked only while a season is `"active"` (pact closed, mid-season) --
 * see `sdd/app-foundation/design-decisions-b11`.
 *
 * `SeasonGateStatus` mirrors `SeasonStatus` (`"pactOpen" | "active" |
 * "closed"`) plus the `"noSeason"` sentinel for "the circle never had one".
 * `join-circle.ts` derives it from its single `findLatestByCircle` read
 * (there is deliberately no separate gate reader: a second read could see a
 * different season state than the one the approval reset acts on).
 */
export type SeasonGateStatus = "noSeason" | "pactOpen" | "closed" | "active";

/** Joining is blocked only while a season is active -- pact closed, mid-season (A2, B11). */
export function canJoinCircle(status: SeasonGateStatus): boolean {
  return status !== "active";
}
