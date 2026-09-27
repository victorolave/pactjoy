/**
 * F5, G5, G6 (season-aggregation spec): the participant-level aggregates
 * from Notion's full-season worked example (Mecanicas, "1.000 puntos" ->
 * "Registros"). Unlike F1-F4/G1-G4 (`f-full-season.rows.ts`,
 * `g-consistency.rows.ts`), which only need the published season-total
 * AGGREGATE per commitment, these three need `scoreMember`'s full
 * `ScoreInput` — real per-week/per-day entries for all four commitments —
 * because they exercise the participant-level composition
 * (`pauseAwareWeekSessions` wired across every commitment and week) rather
 * than a single already-generated `SessionResult[]`.
 *
 * Every entry below is reconstructed directly from Notion's own
 * week-by-week breakdown (quoted in each section), not invented to force a
 * match: the aggregate each commitment produces is cross-checked against
 * F1-F4/G1-G4 in `participant-full-season.test.ts`.
 */
import type { Season } from "../../calendar/season-calendar";
import { seasonDay } from "../../calendar/season-calendar";
import type { Entry } from "../../entry/entry";
import { fromInt } from "../../fraction/fraction";
import type { PauseRequest } from "../../pause/pause";
import type { ScoreInput } from "../../scoring/member-score";
import {
  buildDoneCommitment,
  buildDoneEntry,
  buildPauseRequest,
  buildQuantityCommitment,
  buildQuantityEntry,
  buildWeeklyTotalCommitment,
} from "../../test-support/builders";
import { fr } from "../../test-support/fraction-literal";

const SEASON: Season = { lengthWeeks: 8, startWeekday: 0 };

// --- Leer: tiempo x alcanzar x 5 veces/semana x minimo 10 x ideal 30 (peso 25%) ---
const leer = buildQuantityCommitment(
  "leer",
  25,
  "minutes",
  { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) },
  { kind: "timesPerWeek", times: 5 },
);

/**
 * Notion: "Leer (40): 24 x 30 min - 6 x 20 min - 4 x 10 min - 2 x 5 min - 4
 * sin registro." Split 5/week (no pause, so no best-N truncation): 3 x 30
 * min every week (24 total) plus two more slots/week carrying the remaining
 * 16 entries (6 x 20, 4 x 10, 2 x 5, 4 missing). `null` = no entry that slot
 * (counts as 0 progress once the season/grace has fully passed, same as A1).
 */
const LEER_WEEKS: readonly (readonly (number | null)[])[] = [
  [30, 30, 30, 20, 20],
  [30, 30, 30, 20, 20],
  [30, 30, 30, 20, 20],
  [30, 30, 30, 10, 10],
  [30, 30, 30, 10, 10],
  [30, 30, 30, 5, 5],
  [30, 30, 30, null, null],
  [30, 30, 30, null, null],
];

const leerEntries: readonly Entry[] = LEER_WEEKS.flatMap((slots, week) =>
  slots.flatMap((minutes, offset) =>
    minutes === null ? [] : [buildQuantityEntry("leer", week * 7 + offset, fromInt(minutes))],
  ),
);

// --- Ingles: tiempo x alcanzar x semanal acumulado x minimo 60 x ideal 150 (peso 25%) ---
const ingles = buildWeeklyTotalCommitment("ingles", 25, "minutes", {
  direction: "reach",
  minimum: fromInt(60),
  ideal: fromInt(150),
});

/** Notion: "Ingles (8 semanas): 150, 180, 120, 90, 60, 45, 150, 200." One entry per week suffices (the week's total is what's scored). */
const INGLES_WEEKLY_TOTALS: readonly number[] = [150, 180, 120, 90, 60, 45, 150, 200];

const inglesEntries: readonly Entry[] = INGLES_WEEKLY_TOTALS.map((total, week) =>
  buildQuantityEntry("ingles", week * 7, fromInt(total)),
);

// --- Gym: hecho x alcanzar x 3 veces/semana x pausa salud (peso 30%) ---
const gym = buildDoneCommitment("gym", 30, { kind: "timesPerWeek", times: 3 });

/**
 * Notion: "pausa dias 25-35 (11 dias <= 28)" (1-indexed) = engine days 24-34
 * (0-indexed, `SeasonDay` is 0-based). Approved, fixed end, requested on the
 * start day (non-retroactive). Well under the D9 50% cap (28 days for an
 * 8-week season) so `capPausedDays` never trims it.
 */
const gymPause: PauseRequest = buildPauseRequest(
  "gym",
  24,
  { kind: "fixed", lastDay: seasonDay(34) },
  { kind: "approved", decidedOn: seasonDay(24), resumedOn: null },
);

/**
 * Notion: "Sesiones contadas: 3, 3, 2, 1, -, 3 (hizo 4), 2, 3 = 17" of 19
 * opportunities. Week 3 (S4, engine days 21-27) has 3 active days before the
 * pause starts (day 24) -> N prorates to round(3x3/7) = 1. Week 4 (S5, days
 * 28-34) is entirely inside the pause -> excluded whole, not scored as zero
 * (D8). Week 5 (S6) logs 4 done sessions; only the best 3 count (D4).
 */
const gymEntries: readonly Entry[] = [
  ...[0, 1, 2].map((offset) => buildDoneEntry("gym", 0 * 7 + offset)), // S1: 3/3
  ...[0, 1, 2].map((offset) => buildDoneEntry("gym", 1 * 7 + offset)), // S2: 3/3
  ...[0, 1].map((offset) => buildDoneEntry("gym", 2 * 7 + offset)), // S3: 2/3
  buildDoneEntry("gym", 3 * 7 + 0), // S4: the one active-day session (N prorated to 1)
  // S5 (week 4, days 28-34): entirely paused -- no entries needed, excluded whole.
  ...[0, 1, 2, 3].map((offset) => buildDoneEntry("gym", 5 * 7 + offset)), // S6: did 4, best 3 count
  ...[0, 1].map((offset) => buildDoneEntry("gym", 6 * 7 + offset)), // S7: 2/3
  ...[0, 1, 2].map((offset) => buildDoneEntry("gym", 7 * 7 + offset)), // S8: 3/3
];

// --- Dibujar: hecho x alcanzar x dias especificos mar/jue/sab (peso 20%) ---
const TUESDAY = 1;
const THURSDAY = 3;
const SATURDAY = 5;
const dibujar = buildDoneCommitment("dibujar", 20, {
  kind: "specificDays",
  weekdays: [TUESDAY, THURSDAY, SATURDAY],
});

/** Notion: "Dibujar (24): por semana 3, 3, 2, 2, 3, 1, 2, 2 = 18." Which of the 3 scheduled weekdays is skipped doesn't change the score (all are `done`, worth the same progress). */
const DIBUJAR_WEEKLY_WEEKDAYS: readonly (readonly number[])[] = [
  [TUESDAY, THURSDAY, SATURDAY],
  [TUESDAY, THURSDAY, SATURDAY],
  [TUESDAY, THURSDAY],
  [TUESDAY, THURSDAY],
  [TUESDAY, THURSDAY, SATURDAY],
  [TUESDAY],
  [TUESDAY, THURSDAY],
  [TUESDAY, THURSDAY],
];

const dibujarEntries: readonly Entry[] = DIBUJAR_WEEKLY_WEEKDAYS.flatMap((weekdays, week) =>
  weekdays.map((weekday) => buildDoneEntry("dibujar", week * 7 + weekday)),
);

/**
 * The whole participant's full-season `ScoreInput` (`scoreMember`'s own
 * parameter shape). `today` is day 56 (one past the season's last day, 55)
 * so R1 (slice 6b) counts every week: the season's own last week ends on
 * day 55, whose grace deadline is day 56 — `today` must be AT LEAST that
 * for R1 to close it too, not merely at the season's own last day.
 */
export const participantFullSeasonInput: ScoreInput = {
  season: SEASON,
  commitments: [leer, ingles, gym, dibujar],
  entries: [...leerEntries, ...inglesEntries, ...gymEntries, ...dibujarEntries],
  pauses: [gymPause],
  today: seasonDay(56),
};

/** F5: 550/3 + 725/4 + 5100/19 + 150 exact -- Notion shows 783,0044... (rounded display 783). */
export const F5_ID = "F5";
export const expectedParticipantTotalPoints = fr("178525/228");

/** G5 (D2): Sigma(reached)/Sigma(opportunities) = (34+7+17+18)/(40+8+19+24) = 76/91 -- Notion: 83,5%. */
export const G5_ID = "G5";
export const expectedParticipantConsistency = fr("76/91");

/** G6 (D2): totalPoints / 1000 = 178525/228000 = 7141/9120 (reduced) -- Notion: 78,3%. */
export const G6_ID = "G6";
export const expectedParticipantIdealCompletion = fr("7141/9120");
