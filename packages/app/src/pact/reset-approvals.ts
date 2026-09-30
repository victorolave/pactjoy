import type { Season } from "../season/season.ts";

/**
 * Returns `season` with every member's approval dropped (PA-2, PA-5, PA-6,
 * B2). Every pre-close change to what the members are approving -- season
 * params, commitments, or who the members are -- calls this so the pact can
 * never close on approvals given for a different pact. Does not bump
 * `version`: each caller already does so in the same write.
 */
export function resetApprovals(season: Season): Season {
  return { ...season, approvals: [] };
}
