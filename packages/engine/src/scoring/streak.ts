/**
 * Streak (D11): consecutive opportunities kept, in the commitment's own
 * streak unit — Mecanicas' "Rachas" section: "dias en habitos diarios o de
 * dias especificos, semanas en N veces por semana y semanal acumulado."
 * A paused (or on-hold) opportunity freezes the streak: it neither breaks
 * nor extends it ("la pausa congela la racha: ni la rompe ni la alarga").
 * Best is a running maximum, preserved independently of a later reset.
 */
import type { SessionResult } from "../opportunity/per-session.ts";

export type StreakUnit = "day" | "week";

export interface Streak {
  readonly unit: StreakUnit;
  readonly current: number;
  readonly best: number;
}

/**
 * One opportunity's own contribution to the streak: `"kept"` extends it,
 * `"broken"` resets it, `"frozen"` (paused/on-hold) leaves it untouched.
 */
export type StreakOutcome = "kept" | "broken" | "frozen";

/**
 * D11: a `timesPerWeek`/`weeklyTotal` week maintains the streak only if
 * EVERY one of its (prorated) sessions reached the minimum — a
 * `weeklyTotal` week always produces exactly one session
 * (`opportunity/weekly-total.ts`'s `weeklyTotalResult`), so `every` degrades
 * correctly to "that one session reached the minimum" for it too, with no
 * special case needed. `excluded` (the week's own paused/on-hold status,
 * from `pause/pause-aware-week.ts`) freezes it instead, regardless of any
 * session data.
 */
export function weekStreakOutcome(
  excluded: boolean,
  sessions: readonly SessionResult[],
): StreakOutcome {
  if (excluded) return "frozen";
  return sessions.every((session) => session.consistent) ? "kept" : "broken";
}

/** D11: a single day-bound (`specificDays`) opportunity's own outcome. */
export function dayStreakOutcome(excluded: boolean, session: SessionResult): StreakOutcome {
  if (excluded) return "frozen";
  return session.consistent ? "kept" : "broken";
}

/**
 * Folds a chronological sequence of per-opportunity {@link StreakOutcome}s
 * into a {@link Streak}. `"kept"` extends `current` (and `best`, if it's a
 * new maximum); `"broken"` resets `current` to zero; `"frozen"` changes
 * neither — the pause-freeze rule.
 */
export function computeStreak(unit: StreakUnit, outcomes: readonly StreakOutcome[]): Streak {
  let current = 0;
  let best = 0;
  for (const outcome of outcomes) {
    if (outcome === "kept") {
      current += 1;
      if (current > best) best = current;
    } else if (outcome === "broken") {
      current = 0;
    }
  }
  return { unit, current, best };
}
