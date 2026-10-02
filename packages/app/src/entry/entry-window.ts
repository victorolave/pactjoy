import { graceDeadline, type Schedule, type SeasonDay, seasonDay, weekOf } from "@pactjoy/engine";

export type EntryWindowError =
  | { readonly kind: "FutureDay" }
  | { readonly kind: "OutsideSeason" }
  | { readonly kind: "WindowClosed" };

export interface EntryWindowInput {
  readonly schedule: Schedule;
  /** The opportunity day the entry counts toward. */
  readonly day: SeasonDay;
  /** The season day "now" falls on (resolved upstream in the season's timezone). */
  readonly today: SeasonDay;
  readonly lengthWeeks: number;
  /**
   * B7: extra days a rejected pause (E18) adds to the grace period. The
   * trigger is wired by the future `app-pause-workflow` change; until then
   * every caller passes 0 (the default).
   */
  readonly pauseGraceExtensionDays?: number;
}

const DAYS_PER_WEEK = 7;

/**
 * The last day of the period an entry on `day` belongs to: the day itself
 * for day-bound opportunities (`specificDays`), the week's last day for
 * week-bound ones (`timesPerWeek` sessions and `weeklyTotal`, A9/B8).
 * Weeks count from the season's start day.
 */
function periodEnd(schedule: Schedule, day: SeasonDay): SeasonDay {
  if (schedule.period === "perSession" && schedule.frequency.kind === "specificDays") {
    return day;
  }
  return seasonDay(weekOf(day) * DAYS_PER_WEEK + (DAYS_PER_WEEK - 1));
}

/**
 * The last day an entry for `day` may still be recorded, edited or deleted:
 * the engine's grace deadline of the opportunity's period plus the pause
 * extension (B7). The ONE formula behind {@link checkEntryWindow} and the
 * `graceUntil` Today shows, so the two cannot disagree.
 */
export function entryWindowDeadline(
  schedule: Schedule,
  day: SeasonDay,
  pauseGraceExtensionDays = 0,
): SeasonDay {
  return seasonDay(graceDeadline(periodEnd(schedule, day)) + pauseGraceExtensionDays);
}

/**
 * Whether an entry for `day` may be recorded (or, in S8, edited/deleted)
 * `today` (ER-2, ER-8, ER-9, ER-10..ER-13): not in the future (A10), inside
 * the season, and no later than the period's grace deadline (engine
 * `graceDeadline`, end of the next day) plus any pause extension (B7).
 * Everything is SeasonDay arithmetic: real time was already converted by
 * the Clock/season-calendar (ADR-0004, ADR-0009).
 */
export function checkEntryWindow(input: EntryWindowInput): EntryWindowError | null {
  if (input.day > input.today) {
    return { kind: "FutureDay" };
  }
  if (input.day >= input.lengthWeeks * DAYS_PER_WEEK) {
    return { kind: "OutsideSeason" };
  }
  const deadline = entryWindowDeadline(input.schedule, input.day, input.pauseGraceExtensionDays);
  return input.today > deadline ? { kind: "WindowClosed" } : null;
}
