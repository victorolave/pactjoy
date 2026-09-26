/**
 * Calendar days resolved to plain integers, never `Date`/`Intl`/`Temporal`.
 * See ADR-0004: the engine receives only resolved calendar days; converting
 * real instants (in the season's timezone) to a `SeasonDay` is
 * `packages/app`'s job, not this module's.
 */

/** 0-based integer day index counted from the season's start day. */
export type SeasonDay = number & { readonly __brand: "SeasonDay" };

/** 0 = Monday, per ISO weekday numbering shifted to a 0-based index. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface Season {
  readonly lengthWeeks: 4 | 6 | 8 | 12;
  readonly startWeekday: Weekday;
}

/**
 * Validates and brands a plain integer as a {@link SeasonDay}.
 *
 * @throws {RangeError} if `n` is not a non-negative safe integer.
 */
export function seasonDay(n: number): SeasonDay {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(`seasonDay: ${n} is not a non-negative safe integer`);
  }
  return n as SeasonDay;
}

/** The season week (0-based) that a day falls in. */
export function weekOf(day: SeasonDay): number {
  return (day - (day % 7)) / 7;
}

/** The {@link Weekday} that a day falls on, given the season's own start weekday. */
export function weekdayOf(season: Season, day: SeasonDay): Weekday {
  return ((season.startWeekday + day) % 7) as Weekday;
}

/** All 7 weekdays, Monday (0) through Sunday (6). */
export const daysOfWeek: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];
