/**
 * Series G (consistency and idealCompletion per commitment, D1). G1-G4 are
 * the same four commitments as `f-full-season.rows.ts`'s F1-F4 — reusing
 * their `sessions` here (rather than re-deriving equivalent fixtures)
 * guarantees the two families can never silently drift apart.
 *
 * G5-G6 (participant-level D2 aggregation) live in
 * `participant-full-season.rows.ts`/`.test.ts` instead, for the same reason
 * F5 does (`f-full-season.rows.ts`'s own comment): they need `scoreMember`'s
 * full `ScoreInput` (real week-by-week entries for all four commitments),
 * not just this file's per-commitment aggregate.
 */
import type { Fraction } from "../../fraction/fraction.ts";
import type { SessionResult } from "../../opportunity/per-session.ts";
import { fr } from "../../test-support/fraction-literal.ts";
import { fCommitmentRows } from "./f-full-season.rows.ts";

export interface ConsistencyRow {
  readonly id: string;
  readonly summary: string;
  readonly weightPercent: number;
  readonly sessions: readonly SessionResult[];
  readonly expectedConsistency: Fraction;
  readonly expectedIdealCompletion: Fraction;
}

function gRowFromF(
  fId: string,
  expectedConsistency: Fraction,
  expectedIdealCompletion: Fraction,
): ConsistencyRow {
  const source = fCommitmentRows.find((row) => row.id === fId);
  if (!source) {
    throw new RangeError(`g-consistency.rows: no matching F row for "${fId}"`);
  }
  return {
    id: fId.replace("F", "G"),
    summary: `consistency and idealCompletion for the same commitment as ${fId}`,
    weightPercent: source.weightPercent,
    sessions: source.sessions,
    expectedConsistency,
    expectedIdealCompletion,
  };
}

export const gConsistencyRows: readonly ConsistencyRow[] = [
  gRowFromF("F1", fr("34/40"), fr("11/15")),
  gRowFromF("F2", fr("7/8"), fr("29/40")),
  gRowFromF("F3", fr("17/19"), fr("17/19")),
  gRowFromF("F4", fr("18/24"), fr("3/4")),
];
