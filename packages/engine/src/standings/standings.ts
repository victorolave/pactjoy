/**
 * Season standings (Clasificación): ranks eligible participants by points
 * (D... glossary: `standings`). No Notion worked-example rows exist for this
 * capability — the tie rule (Q2/R2) and eligibility rule (Q3) are engine-
 * authored fixtures derived from the binding decisions below, verified
 * against Notion's Mecánicas page (Círculo section) at apply time.
 *
 * `MemberId` is defined here, not in `commitment/commitment.ts`, because
 * standings (slice 7a) is currently its only consumer; a future slice may
 * relocate it if a `Member` module is introduced.
 */
import type { Fraction } from "../fraction/fraction";
import { roundHalfUp } from "../fraction/fraction";

export type MemberId = string & { readonly __brand: "MemberId" };

/**
 * One participant's season points plus eligibility (Q3): a member who left
 * the circle mid-season is `"left"` and is excluded from the ranking
 * entirely — not just hidden, but also excluded from the rank-position count
 * of the remaining participants (so leaving never shifts anyone else's
 * displayed rank). Hiding the standings display altogether when only one
 * member remains is a presentation-layer (apps/web) rule, out of scope here.
 */
export interface StandingsParticipant {
  readonly memberId: MemberId;
  readonly points: Fraction;
  readonly status: "active" | "left";
}

export interface StandingsRow {
  readonly memberId: MemberId;
  readonly rank: number;
  readonly points: Fraction;
}

/**
 * Ranks eligible participants (`status !== "left"`, Q3) by points,
 * descending. Ties share rank with no secondary tiebreaker (Q2: `1, 2, 2,
 * 4`, never `1, 2, 2, 3`) and keep their relative input order (stable sort).
 *
 * **R2 override**: the comparison — both for ordering and for detecting a
 * tie — uses each participant's `roundHalfUp(points)` (the same exact
 * rounding rule `fraction.ts` already implements for D10 display), never the
 * exact `Fraction`. Two participants who would both show `250` are tied and
 * share rank even if their exact fractions differ. This module reuses
 * `roundHalfUp` directly rather than re-implementing rounding; once
 * `display/display.ts`'s `displayPoints` exists (a later task), a caller
 * showing a member's rank next to their displayed points gets the same
 * value from both functions because both are `roundHalfUp` underneath.
 */
export function rankStandings(
  participants: readonly StandingsParticipant[],
): readonly StandingsRow[] {
  const eligible = participants
    .filter((participant) => participant.status !== "left")
    .map((participant) => ({
      ...participant,
      displayedPoints: roundHalfUp(participant.points),
    }));

  const sorted = [...eligible].sort((a, b) => {
    if (a.displayedPoints > b.displayedPoints) return -1;
    if (a.displayedPoints < b.displayedPoints) return 1;
    return 0;
  });

  const rows: StandingsRow[] = [];
  let previousRank = 0;
  let previousDisplayedPoints: bigint | null = null;
  sorted.forEach((participant, index) => {
    const rank =
      previousDisplayedPoints !== null && participant.displayedPoints === previousDisplayedPoints
        ? previousRank
        : index + 1;
    rows.push({ memberId: participant.memberId, rank, points: participant.points });
    previousRank = rank;
    previousDisplayedPoints = participant.displayedPoints;
  });
  return rows;
}
