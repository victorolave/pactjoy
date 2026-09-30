import type { MemberId } from "@pactjoy/engine";
import type { PactApproval, Season } from "../season/season.ts";
import type { Instant } from "../time/instant.ts";
import { epochDay, type LocalDate, localDateOfEpochDay } from "../time/local-date.ts";

/**
 * Unanimity (PA-1, new PA-11/B4): true once every currently active member
 * has an approval recorded. A circle with zero active members is never
 * unanimously approved -- there is nobody whose approval could complete it.
 * Defensive and kept on purpose: a non-archived circle always has an active
 * member (archiving on the last leave), so this is unreachable in
 * production, but `every` over `[]` is vacuously true and would silently
 * close a pact if that invariant ever broke. Works identically for a solo
 * (1-member) circle: the single member's own approval already satisfies
 * "every active member has approved" -- no member-count special case
 * needed (B4).
 */
export function isUnanimouslyApproved(
  activeMemberIds: readonly MemberId[],
  approvals: readonly PactApproval[],
): boolean {
  if (activeMemberIds.length === 0) {
    return false;
  }
  return activeMemberIds.every((id) => approvals.some((approval) => approval.memberId === id));
}

/**
 * B3 (corrected, PA-7): if the closing approval lands on or before the
 * season's nominal start date, the season starts on that nominal date. If
 * it lands after, the season starts the day after closing. `lengthWeeks`
 * is never touched here (A6: the full length is always kept, so the end
 * date shifts by the same amount as the start).
 */
export function computeActualStart(nominalStart: LocalDate, closingDate: LocalDate): LocalDate {
  if (epochDay(closingDate) <= epochDay(nominalStart)) {
    return nominalStart;
  }
  return localDateOfEpochDay(epochDay(closingDate) + 1);
}

/**
 * Closes the pact (PA-1): flips `status` to `"active"`, stamps
 * `pactClosedAt`, and sets `actualStart` per the corrected B3 rule above.
 * `approve-pact.ts` is the only production caller, once
 * {@link isUnanimouslyApproved} returns true for the just-updated
 * `approvals` array (passed in explicitly, since it must include the
 * approval that just completed unanimity).
 */
export function closeSeason(
  season: Season,
  approvals: readonly PactApproval[],
  closingInstant: Instant,
  closingDate: LocalDate,
): Season {
  return {
    ...season,
    approvals,
    status: "active",
    pactClosedAt: closingInstant,
    actualStart: computeActualStart(season.nominalStart, closingDate),
    version: season.version + 1,
  };
}
