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

const DAYS_PER_WEEK = 7;

/**
 * Validates that a {@link SeasonDay} falls within `season`'s own length
 * (`0 <= day < lengthWeeks * 7`). Meaningless without opportunity
 * generation to bound against, so it's a separate assertion from
 * {@link seasonDay}'s own construction-time check. Called once, at the
 * entry point of `weekSessionsOf` (`opportunity/opportunity.ts`), before any
 * day within the week is derived from it — not from every place a day is
 * used, to keep it out of the per-opportunity hot path.
 *
 * @throws {RangeError} if `day >= season.lengthWeeks * 7`.
 */
export function assertValidSeasonDay(season: Season, day: SeasonDay): void {
  const maxDay = season.lengthWeeks * DAYS_PER_WEEK;
  if (day >= maxDay) {
    throw new RangeError(
      `assertValidSeasonDay: day ${day} is out of range for a ${season.lengthWeeks}-week season (max ${maxDay - 1})`,
    );
  }
}
