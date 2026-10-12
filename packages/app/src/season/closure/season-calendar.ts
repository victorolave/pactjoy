import { seasonDay } from "@pactjoy/engine";
import { type ReviewDay, reviewDayOf } from "../../review/review-schedule.ts";
import type { Instant } from "../../time/instant.ts";
import type { LocalDate } from "../../time/local-date.ts";
import { localDateOfSeasonDay } from "../../time/season-calendar.ts";
import type { TimeZone } from "../../time/time-zone.port.ts";
import type { Season, SeasonLengthWeeks } from "../season.ts";

const DAYS_PER_WEEK = 7;

/**
 * The end-of-season calendar, pure. DAYS ARE 1-BASED, like the review calendar (`review-schedule.ts`),
 * and `L` is the season length in weeks:
 * - days `1 .. L*7` are the season itself;
 * - day `L*7+1` is the grace day (entries are still accepted); the closing review is due from here;
 * - day `L*7+2` (`resultsFrom`) opens the results and the closure, and the season may be finalized;
 * - day `L*7+8` (`staleFrom`) is seven full days after the last season day: the circle may move on
 *   to its next season without the members who have not closed yet.
 */
export interface SeasonCloseCalendar {
  readonly lastDay: number;
  readonly graceDay: number;
  readonly resultsFrom: number;
  readonly staleFrom: number;
}

export function seasonCloseCalendar(lengthWeeks: SeasonLengthWeeks): SeasonCloseCalendar {
  const lastDay = lengthWeeks * DAYS_PER_WEEK;
  return {
    lastDay,
    graceDay: lastDay + 1,
    resultsFrom: lastDay + 2,
    staleFrom: lastDay + 8,
  };
}

/**
 * Where `now` stands against the season, in the season's own time zone: the single conversion from
 * an instant to a 1-based season day for the closing lifecycle (reuses {@link reviewDayOf}).
 */
export function seasonCloseDay(season: Season, now: Instant, timeZone: TimeZone): ReviewDay {
  return reviewDayOf(timeZone.localDateAt(now, season.timeZone), season.actualStart);
}

export interface SeasonCloseDates {
  /** The civil date the results and the closure open. */
  readonly resultsOn: LocalDate;
  /** The civil date the circle may move on without the members who have not closed. */
  readonly staleOn: LocalDate;
}

/** The calendar dates of {@link SeasonCloseCalendar}, or `null` while the season has no start day. */
export function closeDatesOf(season: Season): SeasonCloseDates | null {
  const start = season.actualStart;
  if (start === null) return null;
  const calendar = seasonCloseCalendar(season.lengthWeeks);
  return {
    resultsOn: localDateOfSeasonDay(seasonDay(calendar.resultsFrom - 1), start),
    staleOn: localDateOfSeasonDay(seasonDay(calendar.staleFrom - 1), start),
  };
}
