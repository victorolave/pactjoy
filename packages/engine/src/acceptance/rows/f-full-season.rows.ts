/**
 * Series F (season totals, D1/D2, and the `exact-arithmetic` spec's
 * rounding-only-at-display regression rows).
 *
 * F1-F4 (season-aggregation spec): Notion's worked-examples page publishes
 * only the season-total AGGREGATE per commitment (weight, exact average,
 * exact points, consistency) — not a week-by-week entry breakdown.
 * `evenSplitSessions` below builds an engine-constructed `SessionResult[]`
 * whose sum-of-progress, count and reached-count are EXACTLY the
 * Notion-published aggregate numbers; `scoreCommitmentSoFar` (the
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
 * F5 (participant season total) is a different kind of row — it needs
 * `scoreMember`'s full `ScoreInput` (real week-by-week entries for all four
 * commitments), not just this file's per-commitment aggregate — and lives in
 * `participant-full-season.rows.ts`/`.test.ts` instead. F9's own fixed-row
 * form is out of scope here too: it's exercised by
 * `scoring/invariants.property.test.ts` (property-based, no fixed row) and
 * only referenced here by id for the catalog.
 *
 * F10-F13 (D12 mid-season recompute, slice 6b): Notion's own example uses
 * 1-indexed day numbers ("dia 1 = inicio"); this file converts every one of
 * them to the engine's 0-indexed `SeasonDay` (Notion day N -> engine day
 * N-1). Leer (250 pts, 25%, 5x/week, 8-week/56-day season = 40 total
 * opportunities): weeks 0-3 (Notion S1-S4) are fully done at 100% (20
 * opportunities); `today`/pauses vary per row. Every value below was
 * hand-derived from Notion's own GIVEN before writing any code (see
 * `sdd/scoring-engine/apply-progress` for the full derivation).
 */

import type { Season, SeasonDay } from "../../calendar/season-calendar.ts";
import { seasonDay } from "../../calendar/season-calendar.ts";
import type { Commitment } from "../../commitment/commitment.ts";
import type { Entry } from "../../entry/entry.ts";
import type { Fraction } from "../../fraction/fraction.ts";
import { div, fromInt } from "../../fraction/fraction.ts";
import type { SessionResult } from "../../opportunity/per-session.ts";
import type { PauseRequest } from "../../pause/pause.ts";
import {
  buildDoneCommitment,
  buildDoneEntry,
  buildPauseRequest,
} from "../../test-support/builders.ts";
import { fr } from "../../test-support/fraction-literal.ts";

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

const midSeasonSeason: Season = { lengthWeeks: 8, startWeekday: 0 };

/** Leer: done x reach x perSession x 5x/week (matches Notion's D12 example: "todas al 100%" — a boolean-shaped 100%-or-nothing outcome keeps every value an exact whole number). */
const leerMidSeason: Commitment = buildDoneCommitment("leer", 25, {
  kind: "timesPerWeek",
  times: 5,
});

/** Weeks 0-3 (Notion S1-S4), fully done: 4 x 5 = 20 opportunities at 100%. */
const leerFirstFourWeeksDone: readonly Entry[] = Array.from({ length: 4 }, (_, week) =>
  Array.from({ length: 5 }, (_, i) => buildDoneEntry("leer", week * 7 + i)),
).flat();

export interface MidSeasonRow {
  readonly id: string;
  readonly summary: string;
  readonly season: Season;
  readonly commitment: Commitment;
  readonly entries: readonly Entry[];
  readonly pauses: readonly PauseRequest[];
  readonly today: SeasonDay;
  readonly expectedPoints: Fraction;
}

/**
 * F10-F13 (D12): `scoreMember`'s own two-list design (whole-season
 * denominator, R1-gated numerator) reproduces every one of these exactly —
 * see `scoring/member-score.ts`'s own doc comment for the mechanism.
 */
export const fMidSeasonRows: readonly MidSeasonRow[] = [
  {
    id: "F10",
    summary: "no pause, end of week 4: 20 of 40 season opportunities counted so far -> 125 pts",
    season: midSeasonSeason,
    commitment: leerMidSeason,
    entries: leerFirstFourWeeksDone,
    pauses: [],
    // Engine day 28 = week 3's grace deadline (weekEnd 27 + 1) -- weeks 4-7 have no entries, so
    // whether R1 has counted them yet doesn't change the result either way.
    today: seasonDay(28),
    expectedPoints: fr("125"),
  },
  {
    id: "F11",
    summary:
      "fixed pause weeks 5-6 (Notion S5-S6): denominator shrinks to 30 -- prior entries increase in value",
    season: midSeasonSeason,
    commitment: leerMidSeason,
    entries: leerFirstFourWeeksDone,
    // Notion S5-S6 = engine days 28-41 (Notion day 29 -> engine 28, day 42 -> engine 41).
    pauses: [
      buildPauseRequest(
        "leer",
        28,
        { kind: "fixed", lastDay: seasonDay(41) },
        { kind: "approved", decidedOn: seasonDay(0), resumedOn: null },
      ),
    ],
    today: seasonDay(28),
    expectedPoints: fr("500/3"),
  },
  {
    id: "F12",
    summary:
      "open pause from Notion day 29 (engine day 28), today = Notion day 35 (engine day 34): week 5 (Notion S5) entirely paused -- denominator 35",
    season: midSeasonSeason,
    commitment: leerMidSeason,
    entries: leerFirstFourWeeksDone,
    pauses: [
      buildPauseRequest(
        "leer",
        28,
        { kind: "open" },
        { kind: "approved", decidedOn: seasonDay(28), resumedOn: null },
      ),
    ],
    today: seasonDay(34),
    expectedPoints: fr("1000/7"),
  },
  {
    id: "F13",
    summary:
      "same open pause, today = Notion day 36 (engine day 35): week 6 (Notion S6) has 6 active days -> prorated N=4 -- denominator 34, recomputed daily",
    season: midSeasonSeason,
    commitment: leerMidSeason,
    entries: leerFirstFourWeeksDone,
    pauses: [
      buildPauseRequest(
        "leer",
        28,
        { kind: "open" },
        { kind: "approved", decidedOn: seasonDay(28), resumedOn: null },
      ),
    ],
    today: seasonDay(35),
    expectedPoints: fr("2500/17"),
  },
];
