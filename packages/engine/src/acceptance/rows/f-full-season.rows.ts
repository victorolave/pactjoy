/**
 * Series F (season totals, D1/D2, and the `exact-arithmetic` spec's
 * rounding-only-at-display regression rows).
 *
 * F1-F4 (season-aggregation spec): Notion's worked-examples page publishes
 * only the season-total AGGREGATE per commitment (weight, exact average,
 * exact points, consistency) — not a week-by-week entry breakdown.
 * `evenSplitSessions` below builds an engine-constructed `SessionResult[]`
 * whose sum-of-progress, count and reached-count are EXACTLY the
 * Notion-published aggregate numbers; `scorePerSessionCommitment` (the
 * production function under test) only ever consumes sum/count/
 * reached-count (via `mean` and `reached/total`), so any per-session split
 * honoring those three numbers produces an identical, correct result — the
 * even split chosen here carries no information Notion did not already
 * publish. For F3/F4 the split is in fact the ONLY possible one: with
 * reachedCount sessions each capped at progress 1 summing to exactly
 * reachedCount, every one of them must equal 1.
 *
 * F6-F8 (`exact-arithmetic` spec): fully specified by Notion's own GIVEN
 * text (e.g. "all active opportunities at 100%") — no invented numbers.
 *
 * NOT implemented in this slice (reported as an open question, not
 * guessed): F5 (participant season total) and F9's own fixed-row form are
 * out of scope here — F9 is exercised by `scoring/invariants.property.test.ts`
 * (property-based, no fixed row) and only referenced here by id for the
 * catalog. F5 needs `scoreMember`'s full `ScoreInput` (real week-by-week
 * entries for all four commitments), which this apply batch could not
 * fetch from Notion (no Notion tool available to this executor). F10-F13
 * are slice 6b's own rows (need `today`/mid-season machinery that doesn't
 * exist yet).
 */

import type { Fraction } from "../../fraction/fraction";
import { div, fromInt } from "../../fraction/fraction";
import type { SessionResult } from "../../opportunity/per-session";
import { fr } from "../../test-support/fraction-literal";

function evenSplitSessions(
  progressSum: Fraction,
  count: number,
  reachedCount: number,
): readonly SessionResult[] {
  const perSession = div(progressSum, fromInt(reachedCount));
  const reached: SessionResult[] = Array.from({ length: reachedCount }, () => ({
    value: null,
    progress: perSession,
    consistent: true,
  }));
  const notReached: SessionResult[] = Array.from({ length: count - reachedCount }, () => ({
    value: null,
    progress: fromInt(0),
    consistent: false,
  }));
  return [...reached, ...notReached];
}

export interface CommitmentTotalRow {
  readonly id: string;
  readonly summary: string;
  readonly weightPercent: number;
  readonly sessions: readonly SessionResult[];
  readonly expectedPoints: Fraction;
}

/** F1-F4 (season-aggregation), F7-F8 (exact-arithmetic, rounding-only-at-display regression). */
export const fCommitmentRows: readonly CommitmentTotalRow[] = [
  {
    id: "F1",
    summary: "Leer: season points over 40 opportunities, 34 reaching minimum (weight 25%)",
    weightPercent: 25,
    sessions: evenSplitSessions(fr("88/3"), 40, 34),
    expectedPoints: fr("550/3"),
  },
  {
    id: "F2",
    summary: "Ingles: season points over 8 opportunities, 7 reaching minimum (weight 25%)",
    weightPercent: 25,
    sessions: evenSplitSessions(fr("29/5"), 8, 7),
    expectedPoints: fr("725/4"),
  },
  {
    id: "F3",
    summary: "Gym: season points over 19 opportunities, 17 reaching minimum (weight 30%)",
    weightPercent: 30,
    sessions: evenSplitSessions(fr("17"), 19, 17),
    expectedPoints: fr("5100/19"),
  },
  {
    id: "F4",
    summary: "Dibujar: season points over 24 opportunities, 18 reaching minimum (weight 20%)",
    weightPercent: 20,
    sessions: evenSplitSessions(fr("18"), 24, 18),
    expectedPoints: fr("150"),
  },
  {
    id: "F7",
    summary:
      "rounding each opportunity before summing is forbidden: 19 opportunities at 100% must total exactly 300, not 304",
    weightPercent: 30,
    sessions: evenSplitSessions(fr("19"), 19, 19),
    expectedPoints: fr("300"),
  },
  {
    id: "F8",
    summary:
      "rounding per-opportunity points before summing is forbidden: 40 opportunities at 100% must total exactly 250, not 240",
    weightPercent: 25,
    sessions: evenSplitSessions(fr("40"), 40, 40),
    expectedPoints: fr("250"),
  },
];

export interface TotalPointsRow {
  readonly id: string;
  readonly summary: string;
  readonly commitments: readonly {
    readonly weightPercent: number;
    readonly sessions: readonly SessionResult[];
  }[];
  readonly expectedTotal: Fraction;
}

/** F6: four commitments (25/25/30/20), all active opportunities at 100% -> exact total 1000. */
export const fTotalRows: readonly TotalPointsRow[] = [
  {
    id: "F6",
    summary: "four commitments (25/25/30/20) all at 100% total exactly 1000",
    commitments: [
      { weightPercent: 25, sessions: evenSplitSessions(fromInt(1), 1, 1) },
      { weightPercent: 25, sessions: evenSplitSessions(fromInt(1), 1, 1) },
      { weightPercent: 30, sessions: evenSplitSessions(fromInt(1), 1, 1) },
      { weightPercent: 20, sessions: evenSplitSessions(fromInt(1), 1, 1) },
    ],
    expectedTotal: fromInt(1000),
  },
];

/** F9 is property-based (`scoring/invariants.property.test.ts`) — referenced here by id only, for the catalog. */
export const F9_ID = "F9";
