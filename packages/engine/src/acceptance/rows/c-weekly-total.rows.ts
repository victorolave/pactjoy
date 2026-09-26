import type { Target } from "../../commitment/commitment";
import type { Entry } from "../../entry/entry";
import type { Fraction } from "../../fraction/fraction";
import { fromInt, parseDecimal } from "../../fraction/fraction";
import { buildQuantityEntry } from "../../test-support/builders";
import { fr } from "../../test-support/fraction-literal";

export interface WeekCase {
  readonly week: number;
  readonly entries: readonly Entry[];
  readonly expectedProgress: Fraction;
  readonly expectedConsistent: boolean;
}

export interface WeeklyTotalRow {
  readonly id: string;
  readonly summary: string;
  readonly target: Target;
  /** One case per week checked; C6/C15 check two independent weeks under one row ID. */
  readonly weeks: readonly WeekCase[];
}

/** Inglés: reach, weeklyTotal, minimum 60 min, ideal 150 min. */
const inglesTarget: Target = { direction: "reach", minimum: fromInt(60), ideal: fromInt(150) };

/** Redes: limit, weeklyTotal, ideal 300 min, tolerance 420 min. */
const redesTarget: Target = { direction: "limit", ideal: fromInt(300), tolerance: fromInt(420) };

/**
 * Series C: `weeklyTotal` period — the whole week is one opportunity.
 * C1–C8 use Inglés (`reach`); C9–C15 use Redes (`limit`). C6 and C15 pin
 * non-compensation across two independent weeks; C7/C8 pin the grace
 * period at week close.
 */
export const cWeeklyTotalRows: readonly WeeklyTotalRow[] = [
  {
    id: "C1",
    summary: "entries across the week sum to exactly the minimum",
    target: inglesTarget,
    weeks: [
      {
        week: 0,
        entries: [
          buildQuantityEntry("ingles", 0, parseDecimal("30")),
          buildQuantityEntry("ingles", 1, parseDecimal("30")),
        ],
        expectedProgress: fr("2/5"),
        expectedConsistent: true,
      },
    ],
  },
  {
    id: "C2",
    summary: "entries across the week sum to just below the minimum",
    target: inglesTarget,
    weeks: [
      {
        week: 0,
        entries: [
          buildQuantityEntry("ingles", 0, parseDecimal("20")),
          buildQuantityEntry("ingles", 1, parseDecimal("20")),
          buildQuantityEntry("ingles", 2, parseDecimal("15")),
        ],
        expectedProgress: fr("0"),
        expectedConsistent: false,
      },
    ],
  },
  {
    id: "C3",
    summary: "a single entry accumulates the same as several smaller ones would",
    target: inglesTarget,
    weeks: [
      {
        week: 0,
        entries: [buildQuantityEntry("ingles", 0, parseDecimal("90"))],
        expectedProgress: fr("3/5"),
        expectedConsistent: true,
      },
    ],
  },
  {
    id: "C4",
    summary: "entries across the week sum to exactly the ideal",
    target: inglesTarget,
    weeks: [
      {
        week: 0,
        entries: [
          buildQuantityEntry("ingles", 0, parseDecimal("50")),
          buildQuantityEntry("ingles", 1, parseDecimal("50")),
          buildQuantityEntry("ingles", 2, parseDecimal("50")),
        ],
        expectedProgress: fr("1"),
        expectedConsistent: true,
      },
    ],
  },
  {
    id: "C5",
    summary:
      "the whole week's total entered on a single day gives the same result — spreading is allowed, not required",
    target: inglesTarget,
    weeks: [
      {
        week: 0,
        entries: [buildQuantityEntry("ingles", 0, parseDecimal("150"))],
        expectedProgress: fr("1"),
        expectedConsistent: true,
      },
    ],
  },
  {
    id: "C6",
    summary: "excess progress in one week is capped and never carries to the next week",
    target: inglesTarget,
    weeks: [
      {
        week: 0,
        entries: [buildQuantityEntry("ingles", 0, parseDecimal("300"))],
        expectedProgress: fr("1"),
        expectedConsistent: true,
      },
      {
        week: 1,
        entries: [],
        expectedProgress: fr("0"),
        expectedConsistent: false,
      },
    ],
  },
  {
    id: "C7",
    summary: "a late entry within grace still counts toward the week it was meant for",
    target: inglesTarget,
    weeks: [
      {
        week: 0,
        entries: [
          buildQuantityEntry("ingles", 0, parseDecimal("120")),
          // week 0 ends day 6; grace deadline is day 7 — recorded exactly on it
          buildQuantityEntry("ingles", 6, parseDecimal("30"), 7),
        ],
        expectedProgress: fr("1"),
        expectedConsistent: true,
      },
    ],
  },
  {
    id: "C8",
    summary: "a late entry logged outside grace is rejected for the closed week",
    target: inglesTarget,
    weeks: [
      {
        week: 0,
        entries: [
          buildQuantityEntry("ingles", 0, parseDecimal("120")),
          // grace deadline was day 7 — recorded day 8 is outside it
          buildQuantityEntry("ingles", 6, parseDecimal("30"), 8),
        ],
        expectedProgress: fr("4/5"),
        expectedConsistent: true,
      },
    ],
  },
  {
    id: "C9",
    summary: "a limit total below the ideal gives full progress",
    target: redesTarget,
    weeks: [
      {
        week: 0,
        entries: [buildQuantityEntry("redes", 0, parseDecimal("240"))],
        expectedProgress: fr("1"),
        expectedConsistent: true,
      },
    ],
  },
  {
    id: "C10",
    summary: "a limit total between the ideal and the tolerance gives partial progress",
    target: redesTarget,
    weeks: [
      {
        week: 0,
        entries: [buildQuantityEntry("redes", 0, parseDecimal("360"))],
        expectedProgress: fr("3/4"),
        expectedConsistent: true,
      },
    ],
  },
  {
    id: "C11",
    summary: "a limit total exactly at the tolerance gives exactly half progress",
    target: redesTarget,
    weeks: [
      {
        week: 0,
        entries: [buildQuantityEntry("redes", 0, parseDecimal("420"))],
        expectedProgress: fr("1/2"),
        expectedConsistent: true,
      },
    ],
  },
  {
    id: "C12",
    summary: "a limit total beyond the tolerance gives zero progress",
    target: redesTarget,
    weeks: [
      {
        week: 0,
        entries: [buildQuantityEntry("redes", 0, parseDecimal("480"))],
        expectedProgress: fr("0"),
        expectedConsistent: false,
      },
    ],
  },
  {
    id: "C13",
    summary:
      "a single recorded zero suffices for full progress (the zero must be recorded, not just absent)",
    target: redesTarget,
    weeks: [
      {
        week: 0,
        entries: [buildQuantityEntry("redes", 0, fromInt(0))],
        expectedProgress: fr("1"),
        expectedConsistent: true,
      },
    ],
  },
  {
    id: "C14",
    summary:
      "no entry all week gives zero progress (D3), same as an unrecorded perSession opportunity",
    target: redesTarget,
    weeks: [
      {
        week: 0,
        entries: [],
        expectedProgress: fr("0"),
        expectedConsistent: false,
      },
    ],
  },
  {
    id: "C15",
    summary: "unused margin below the ideal in one week does not carry to the next",
    target: redesTarget,
    weeks: [
      {
        week: 0,
        entries: [buildQuantityEntry("redes", 0, parseDecimal("100"))],
        expectedProgress: fr("1"),
        expectedConsistent: true,
      },
      {
        week: 1,
        entries: [buildQuantityEntry("redes", 7, parseDecimal("500"))],
        expectedProgress: fr("0"),
        expectedConsistent: false,
      },
    ],
  },
];
