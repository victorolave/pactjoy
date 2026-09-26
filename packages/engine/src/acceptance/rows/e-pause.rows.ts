import { seasonDay } from "../../calendar/season-calendar";
import type { Commitment } from "../../commitment/commitment";
import type { Entry } from "../../entry/entry";
import type { Fraction } from "../../fraction/fraction";
import { fromInt } from "../../fraction/fraction";
import type { PauseRequest } from "../../pause/pause";
import {
  buildDoneEntry,
  buildPauseRequest,
  buildQuantityCommitment,
  buildQuantityEntry,
  buildWeeklyTotalCommitment,
} from "../../test-support/builders";
import { fr } from "../../test-support/fraction-literal";

/** E1, E2: pause effect is neutral — full-week pauses redistribute potential across active weeks. */
export interface NeutralPointsRow {
  readonly id: string;
  readonly summary: string;
  readonly weightPercent: number;
  readonly commitment: Commitment;
  readonly timesPerWeek: number;
  readonly weeksCount: number;
  readonly pauses: readonly PauseRequest[];
  readonly today: number;
  /** Weeks (0-based) fully logged at 100%; every other active week is a full miss. */
  readonly fullWeeks: readonly number[];
  readonly expectedPoints: Fraction;
}

const leerTarget = { direction: "reach" as const, minimum: fromInt(1), ideal: fromInt(1) };
const leerCommitment = buildQuantityCommitment("leer", 25, "minutes", leerTarget, {
  kind: "timesPerWeek",
  times: 5,
});

export const eNeutralPointsRows: readonly NeutralPointsRow[] = [
  {
    id: "E1",
    summary: "a full commitment paused for two whole weeks redistributes its potential",
    weightPercent: 25,
    commitment: leerCommitment,
    timesPerWeek: 5,
    weeksCount: 8,
    pauses: [
      buildPauseRequest(
        "leer",
        14,
        { kind: "fixed", lastDay: seasonDay(27) },
        {
          kind: "approved",
          decidedOn: seasonDay(14),
          resumedOn: null,
        },
      ),
    ],
    today: 60,
    fullWeeks: [0, 1, 4, 5, 6, 7],
    expectedPoints: fromInt(250),
  },
  {
    id: "E2",
    summary: "the same commitment without a pause scores lower — motivates the anti-abuse cap",
    weightPercent: 25,
    commitment: leerCommitment,
    timesPerWeek: 5,
    weeksCount: 8,
    pauses: [],
    today: 60,
    fullWeeks: [0, 1, 2, 3, 4, 5],
    expectedPoints: fr("375/2"),
  },
];

/** E3–E6: D6/D7 proration of `timesPerWeek`'s session count N — a pure-function unit, no composition involved. */
export interface SessionCountRow {
  readonly id: string;
  readonly summary: string;
  readonly times: number;
  readonly activeDays: number;
  readonly expected: number | null;
}

export const eSessionCountRows: readonly SessionCountRow[] = [
  { id: "E3", summary: "4 active days out of 7", times: 3, activeDays: 4, expected: 2 },
  { id: "E4", summary: "3 active days out of 7", times: 3, activeDays: 3, expected: 1 },
  { id: "E5", summary: "2 active days out of 7", times: 3, activeDays: 2, expected: 1 },
  {
    id: "E6",
    summary: "1 active day out of 7 prorates N to 0 — the week is fully paused",
    times: 3,
    activeDays: 1,
    expected: null,
  },
];

/** E7–E10: D6/D7 proration of `weeklyTotal` targets, through the pause-aware composition function. */
export interface WeeklyProrationRow {
  readonly id: string;
  readonly summary: string;
  readonly commitment: Commitment;
  readonly pauses: readonly PauseRequest[];
  readonly today: number;
  readonly expectedPaused: boolean;
  readonly testValues: readonly {
    readonly total: Fraction;
    readonly expectedProgress: Fraction;
    readonly expectedConsistent: boolean;
  }[];
}

const inglesTarget = { direction: "reach" as const, minimum: fromInt(60), ideal: fromInt(150) };
const redesTarget = { direction: "limit" as const, ideal: fromInt(300), tolerance: fromInt(420) };
const zeroBetsTarget = { direction: "limit" as const, ideal: fromInt(0), tolerance: fromInt(2) };

/** Days 0-2 paused, leaving days 3-6 active (4 active days) — E7/E8/E9's shared proration setup. */
const fourActiveDaysPause: readonly PauseRequest[] = [
  buildPauseRequest(
    "row",
    0,
    { kind: "fixed", lastDay: seasonDay(2) },
    {
      kind: "approved",
      decidedOn: seasonDay(0),
      resumedOn: null,
    },
  ),
];

/** Days 0-5 paused, leaving day 6 active (1 active day) — E10's setup, where proration closes the week. */
const oneActiveDayPause: readonly PauseRequest[] = [
  buildPauseRequest(
    "row",
    0,
    { kind: "fixed", lastDay: seasonDay(5) },
    {
      kind: "approved",
      decidedOn: seasonDay(0),
      resumedOn: null,
    },
  ),
];

export const eWeeklyProrationRows: readonly WeeklyProrationRow[] = [
  {
    id: "E7",
    summary: "Inglés (reach, min60/ideal150) prorated over 4 active days",
    commitment: buildWeeklyTotalCommitment("row", 25, "minutes", inglesTarget),
    pauses: fourActiveDaysPause,
    today: 10,
    expectedPaused: false,
    testValues: [
      { total: fromInt(86), expectedProgress: fr("1"), expectedConsistent: true },
      { total: fromInt(50), expectedProgress: fr("25/43"), expectedConsistent: true },
      { total: fromInt(30), expectedProgress: fr("0"), expectedConsistent: false },
    ],
  },
  {
    id: "E8",
    summary: "Redes (limit, ideal300/tolerance420) prorated over 4 active days",
    commitment: buildWeeklyTotalCommitment("row", 25, "minutes", redesTarget),
    pauses: fourActiveDaysPause,
    today: 10,
    expectedPaused: false,
    testValues: [
      { total: fromInt(200), expectedProgress: fr("109/138"), expectedConsistent: true },
    ],
  },
  {
    id: "E9",
    summary: "ideal 0, tolerance 2, prorated over 4 active days — the tolerance still governs",
    commitment: buildWeeklyTotalCommitment("row", 25, "minutes", zeroBetsTarget),
    pauses: fourActiveDaysPause,
    today: 10,
    expectedPaused: false,
    testValues: [
      { total: fromInt(0), expectedProgress: fr("1"), expectedConsistent: true },
      { total: fromInt(1), expectedProgress: fr("1/2"), expectedConsistent: true },
      { total: fromInt(2), expectedProgress: fr("0"), expectedConsistent: false },
    ],
  },
  {
    id: "E10",
    summary:
      "the same commitment over 1 active day prorates the tolerance to 0 — fully paused (D7)",
    commitment: buildWeeklyTotalCommitment("row", 25, "minutes", zeroBetsTarget),
    pauses: oneActiveDayPause,
    today: 10,
    expectedPaused: true,
    testValues: [],
  },
];

/** E11: D8 — a session logged on a paused day does not count. */
export interface PausedDaySessionRow {
  readonly id: string;
  readonly summary: string;
  readonly commitment: Commitment;
  readonly pauses: readonly PauseRequest[];
  readonly today: number;
  readonly entries: readonly Entry[];
  readonly expectedProgresses: readonly Fraction[];
}

export const ePausedDaySessionRows: readonly PausedDaySessionRow[] = [
  {
    id: "E11",
    summary: "one session on an active day and one on a paused day — only the active one counts",
    commitment: buildQuantityCommitment(
      "gym",
      30,
      "times",
      { direction: "reach", minimum: fromInt(1), ideal: fromInt(1) },
      { kind: "timesPerWeek", times: 3 },
    ),
    pauses: [
      buildPauseRequest(
        "gym",
        3,
        { kind: "fixed", lastDay: seasonDay(5) },
        {
          kind: "approved",
          decidedOn: seasonDay(3),
          resumedOn: null,
        },
      ),
    ],
    today: 6,
    entries: [buildDoneEntry("gym", 0), buildDoneEntry("gym", 4)],
    expectedProgresses: [fr("1"), fr("0")],
  },
];

/** E17–E20: pause request lifecycle timing, through the pause-aware composition function. */
export interface LifecycleRow {
  readonly id: string;
  readonly summary: string;
  readonly commitment: Commitment;
  readonly week: number;
  readonly pauses: readonly PauseRequest[];
  readonly today: number;
  readonly entries: readonly Entry[];
  readonly expectedStatus: "scored" | "paused" | "onHold";
  readonly expectedProgresses?: readonly Fraction[];
}

/** min1/ideal10 (reach): a day's entry can score less than 100%, so an excluded day is detectable
 * by its would-be effect on the best-N selection, not just by a same-valued 1-or-0. */
const partialCreditTarget = {
  direction: "reach" as const,
  minimum: fromInt(1),
  ideal: fromInt(10),
};
const lifecycleCommitment = buildQuantityCommitment("row", 25, "minutes", partialCreditTarget, {
  kind: "timesPerWeek",
  times: 3,
});

export const eLifecycleRows: readonly LifecycleRow[] = [
  {
    id: "E17",
    summary:
      "requested day 10, approved day 11 — paused from the request date, excluded even with an entry",
    commitment: lifecycleCommitment,
    week: 1, // days 7-13
    pauses: [
      buildPauseRequest(
        "row",
        10,
        { kind: "open" },
        {
          kind: "approved",
          decidedOn: seasonDay(11),
          resumedOn: null,
        },
      ),
    ],
    today: 11,
    entries: [
      buildQuantityEntry("row", 10, fromInt(10)), // day 10 is paused — would score 1 if (wrongly) counted
      buildQuantityEntry("row", 7, fromInt(5)),
      buildQuantityEntry("row", 8, fromInt(5)),
    ],
    expectedStatus: "scored",
    // 5 active days (7,8,9,12,13) -> N=round(3*5/7)=2; only day7/day8 are eligible -> both count.
    // If day 10 had wrongly counted, the result would be [1, 1/2] instead (its 100% displacing one 50%).
    expectedProgresses: [fr("1/2"), fr("1/2")],
  },
  {
    id: "E18",
    summary: "requested day 10, rejected day 12 — days count normally; grace extends to day 13",
    commitment: buildQuantityCommitment("row", 25, "minutes", partialCreditTarget, {
      kind: "timesPerWeek",
      times: 3,
    }),
    week: 1, // days 7-13
    pauses: [
      buildPauseRequest(
        "row",
        10,
        { kind: "open" },
        { kind: "rejected", decidedOn: seasonDay(12) },
      ),
    ],
    today: 13,
    entries: [
      buildQuantityEntry("row", 10, fromInt(10), seasonDay(13)), // day 10's normal deadline is 11 — late, but within the day-13 extension
      buildQuantityEntry("row", 7, fromInt(5)),
      buildQuantityEntry("row", 8, fromInt(5)),
    ],
    expectedStatus: "scored",
    expectedProgresses: [fr("1"), fr("1/2"), fr("1/2")],
  },
  {
    id: "E19",
    summary:
      "no response in 48h auto-approves from the request date (Q4: the 48h workflow itself is packages/app's)",
    commitment: lifecycleCommitment,
    week: 1,
    pauses: [
      buildPauseRequest(
        "row",
        10,
        { kind: "open" },
        {
          kind: "approved",
          decidedOn: seasonDay(10),
          resumedOn: null,
        },
      ),
    ],
    today: 10,
    entries: [
      buildQuantityEntry("row", 10, fromInt(10)), // paused (single day, today==startDay) — excluded
      buildQuantityEntry("row", 7, fromInt(5)),
      buildQuantityEntry("row", 8, fromInt(5)),
    ],
    expectedStatus: "scored",
    // 6 active days (7,8,9,11,12,13) -> N=round(3*6/7)=3; only 2 real groups -> best-3 pads one empty slot.
    expectedProgresses: [fr("1/2"), fr("1/2"), fr("0")],
  },
  {
    id: "E20",
    summary: "an explicit rejection within 48h still blocks approval — no exclusion at all",
    commitment: lifecycleCommitment,
    week: 1,
    pauses: [
      buildPauseRequest(
        "row",
        10,
        { kind: "open" },
        { kind: "rejected", decidedOn: seasonDay(11) },
      ),
    ],
    today: 12,
    entries: [
      buildQuantityEntry("row", 10, fromInt(10)), // never excluded — rejected, and on time regardless
      buildQuantityEntry("row", 7, fromInt(5)),
      buildQuantityEntry("row", 8, fromInt(5)),
    ],
    expectedStatus: "scored",
    expectedProgresses: [fr("1"), fr("1/2"), fr("1/2")],
  },
];

/** E21: pausing "all" expands to one independent request per commitment (the expansion itself is packages/app's job). */
export const eAllCommitmentsPause = {
  id: "E21",
  summary:
    "a 7-day vacation across 4 commitments — each pauses independently, cap evaluated per commitment",
  commitmentIds: ["leer", "ingles", "gym", "otro"] as const,
  week: 3, // days 21-27 — chosen to align exactly with a full week
  startDay: 21,
  lastDay: 27,
  today: 30,
};

/** E23: consistency counts only active (non-paused) opportunities; streak-freeze proof is deferred to slice 6b's streak.ts. */
export interface ConsistencyRow {
  readonly id: string;
  readonly summary: string;
  readonly weightPercent: number;
  readonly commitment: Commitment;
  readonly weeksCount: number;
  readonly pauses: readonly PauseRequest[];
  readonly today: number;
  /** Weeks (0-based) with all 5 sessions done; `partialWeek` gets 2 done + 3 misses; the rest (paused) are excluded. */
  readonly fullWeeks: readonly number[];
  readonly partialWeek: number;
  readonly expectedConsistency: Fraction;
}

export const eConsistencyRows: readonly ConsistencyRow[] = [
  {
    id: "E23",
    summary:
      "27 of 30 active opportunities reach the minimum — 90% consistency (streak-freeze: see slice 6b)",
    weightPercent: 25,
    commitment: leerCommitment,
    weeksCount: 8,
    pauses: [
      buildPauseRequest(
        "leer",
        14,
        { kind: "fixed", lastDay: seasonDay(27) },
        {
          kind: "approved",
          decidedOn: seasonDay(14),
          resumedOn: null,
        },
      ),
    ],
    today: 60,
    fullWeeks: [0, 1, 4, 5, 6],
    partialWeek: 7,
    expectedConsistency: fr("9/10"),
  },
];
