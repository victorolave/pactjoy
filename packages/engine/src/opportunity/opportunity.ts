/**
 * Dispatches a commitment's own schedule to the right opportunity generator:
 * `period: "perSession"` (`per-session.ts`, `timesPerWeek`/`specificDays`)
 * or `period: "weeklyTotal"` (`weekly-total.ts`, one accumulated result).
 */
import type { Season } from "../calendar/season-calendar.ts";
import { assertValidSeasonDay, seasonDay } from "../calendar/season-calendar.ts";
import type { Commitment, Target } from "../commitment/commitment.ts";
import { targetOf } from "../commitment/commitment.ts";
import type { Entry } from "../entry/entry.ts";
import type { SessionResult } from "./per-session.ts";
import { specificDaysSessions, timesPerWeekSessions } from "./per-session.ts";
import { weeklyTotalResult } from "./weekly-total.ts";

const DAYS_PER_WEEK = 7;

function targetOfCommitment(commitment: Commitment): Target {
  return commitment.unit === "done" ? targetOf(commitment) : commitment.target;
}

/**
 * The week's opportunities for one commitment, dispatched by its own
 * `Frequency`. `weekEntries` must already be filtered to this commitment
 * and this week.
 *
 * Validates `week` against `season` once, here, at the entry point — a
 * season's `lengthWeeks` is always a whole number of weeks, so checking the
 * week's first day is enough to guarantee every day `dayForWeekday` derives
 * from it (in `per-session.ts`) falls inside the season too. Deliberately
 * outside the per-opportunity hot path.
 *
 * **Contract — pure and calendar-agnostic.** Like `per-session.ts` and
 * `weekly-total.ts`, this function has no notion of "today": it returns a
 * result for *whatever* `week` is requested (as long as it's within the
 * season), whether or not that week has actually closed yet — grace is
 * evaluated relative to the requested week's own end, never the current
 * date. A `0` progress for a week still open is **not** the same as a `0`
 * that should count toward consistency or points. Filtering to only the
 * weeks that are closed enough to include in a "so far" aggregate (R1) is
 * the aggregator's job (slice 6b), not this dispatcher's.
 *
 * @throws {RangeError} if `week` falls outside `season`'s length.
 */
export function weekSessionsOf(
  commitment: Commitment,
  season: Season,
  week: number,
  weekEntries: readonly Entry[],
): readonly SessionResult[] {
  assertValidSeasonDay(season, seasonDay(week * DAYS_PER_WEEK));
  const target = targetOfCommitment(commitment);
  if (commitment.schedule.period === "weeklyTotal") {
    return [weeklyTotalResult(target, week, weekEntries)];
  }
  const { frequency } = commitment.schedule;
  if (frequency.kind === "timesPerWeek") {
    return timesPerWeekSessions(target, frequency.times, weekEntries);
  }
  return specificDaysSessions(target, season, week, frequency.weekdays, weekEntries);
}
