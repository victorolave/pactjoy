import type { Season, Weekday } from "../../calendar/season-calendar";
import type { Target } from "../../commitment/commitment";
import type { Entry } from "../../entry/entry";
import type { Fraction } from "../../fraction/fraction";
import { fromInt, parseDecimal } from "../../fraction/fraction";
import { buildDoneEntry, buildQuantityEntry } from "../../test-support/builders";
import { fr } from "../../test-support/fraction-literal";

/** Monday-start, 4-week season — the only calendar shape series N needs. */
export const nFrequencySeason: Season = { lengthWeeks: 4, startWeekday: 0 };

const booleanTarget: Target = { direction: "reach", minimum: fromInt(1), ideal: fromInt(1) };

/** Leer: 5x/week, minimum 10 min, ideal 30 min. */
const leerTarget: Target = { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) };

/** Dibujar's scheduled weekdays: tuesday (1), thursday (3), saturday (5). */
export const dibujarWeekdays: readonly Weekday[] = [1, 3, 5];

export interface FrequencyRow {
  readonly id: string;
  readonly summary: string;
  readonly kind: "timesPerWeek" | "specificDays";
  readonly target: Target;
  /** `times` for timesPerWeek; `dibujarWeekdays.length` for specificDays. */
  readonly slots: number;
  readonly entries: readonly Entry[];
  /** Set only when Notion gives an exact week-level value; `null` when Notion leaves it as "—" (N7). */
  readonly expectedWeekProgress: Fraction | null;
  readonly expectedConsistentCount: number;
}

/**
 * Series N: `timesPerWeek` (Gym, Leer) and `specificDays` (Dibujar)
 * frequency scheduling — D4 (same-day sum, best-N) and D5 (missed-day
 * coverage). N12–N13 (streak) are deferred to slice 6b.
 */
export const nFrequencyRows: readonly FrequencyRow[] = [
  {
    id: "N1",
    summary: "sessions on free days within N slots all count",
    kind: "timesPerWeek",
    target: booleanTarget,
    slots: 3,
    entries: [buildDoneEntry("gym", 0), buildDoneEntry("gym", 1), buildDoneEntry("gym", 2)],
    expectedWeekProgress: fr("1"),
    expectedConsistentCount: 3,
  },
  {
    id: "N2",
    summary: "more sessions than N slots — non-compensation, extras never duplicate the score",
    kind: "timesPerWeek",
    target: booleanTarget,
    slots: 3,
    entries: [0, 1, 2, 3, 4, 5].map((day) => buildDoneEntry("gym", day)),
    expectedWeekProgress: fr("1"),
    expectedConsistentCount: 3,
  },
  {
    id: "N3",
    summary: "a missing session closes its slot at zero",
    kind: "timesPerWeek",
    target: booleanTarget,
    slots: 3,
    entries: [buildDoneEntry("gym", 0), buildDoneEntry("gym", 1)],
    expectedWeekProgress: fr("2/3"),
    expectedConsistentCount: 2,
  },
  {
    id: "N4",
    summary: "no entries — every slot closes at zero",
    kind: "timesPerWeek",
    target: booleanTarget,
    slots: 3,
    entries: [],
    expectedWeekProgress: fr("0"),
    expectedConsistentCount: 0,
  },
  {
    id: "N5",
    summary: "one session per day: a single entry occupies a single slot",
    kind: "timesPerWeek",
    target: leerTarget,
    slots: 5,
    entries: [buildQuantityEntry("leer", 0, parseDecimal("150"))],
    expectedWeekProgress: fr("1/5"),
    expectedConsistentCount: 1,
  },
  {
    id: "N6",
    summary: "more than N sessions — only the best N count (D4)",
    kind: "timesPerWeek",
    target: leerTarget,
    slots: 5,
    entries: [30, 30, 30, 20, 10, 5, 30].map((minutes, day) =>
      buildQuantityEntry("leer", day, parseDecimal(String(minutes))),
    ),
    expectedWeekProgress: fr("14/15"),
    expectedConsistentCount: 5,
  },
  {
    id: "N7",
    summary: "same-day entries sum into one session, occupying only one of N slots (D4)",
    kind: "timesPerWeek",
    target: leerTarget,
    slots: 5,
    entries: [
      buildQuantityEntry("leer", 0, parseDecimal("10")),
      buildQuantityEntry("leer", 0, parseDecimal("20")),
    ],
    // Notion leaves the week-level value as "—" for this row — it only pins the sum, not an average.
    expectedWeekProgress: null,
    expectedConsistentCount: 1,
  },
  {
    id: "N8",
    summary: "an entry on every scheduled day gives full progress on all of them",
    kind: "specificDays",
    target: booleanTarget,
    slots: dibujarWeekdays.length,
    entries: [buildDoneEntry("draw", 1), buildDoneEntry("draw", 3), buildDoneEntry("draw", 5)],
    expectedWeekProgress: fr("1"),
    expectedConsistentCount: 3,
  },
  {
    id: "N9",
    summary: "a missing scheduled day closes at zero when nothing covers it",
    kind: "specificDays",
    target: booleanTarget,
    slots: dibujarWeekdays.length,
    entries: [buildDoneEntry("draw", 1), buildDoneEntry("draw", 3)],
    expectedWeekProgress: fr("2/3"),
    expectedConsistentCount: 2,
  },
  {
    id: "N10",
    summary: "an entry on a non-scheduled day covers a missed scheduled day (D5)",
    kind: "specificDays",
    target: booleanTarget,
    slots: dibujarWeekdays.length,
    entries: [
      buildDoneEntry("draw", 2), // wednesday, not scheduled — covers the missing tuesday
      buildDoneEntry("draw", 3),
      buildDoneEntry("draw", 5),
    ],
    expectedWeekProgress: fr("1"),
    expectedConsistentCount: 3,
  },
  {
    id: "N11",
    summary: "a non-scheduled entry adds nothing when nothing was missed (D5)",
    kind: "specificDays",
    target: booleanTarget,
    slots: dibujarWeekdays.length,
    entries: [
      buildDoneEntry("draw", 1),
      buildDoneEntry("draw", 2), // wednesday, extra — nothing to cover
      buildDoneEntry("draw", 3),
      buildDoneEntry("draw", 5),
    ],
    expectedWeekProgress: fr("1"),
    expectedConsistentCount: 3,
  },
];
