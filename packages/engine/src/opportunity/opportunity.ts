/**
 * Dispatches a commitment's own schedule to the right opportunity generator.
 * Only `period: "perSession"` is handled here — `weeklyTotal` arrives in
 * slice 4, at which point this dispatch grows a second branch.
 */
import type { Season } from "../calendar/season-calendar";
import { assertValidSeasonDay, seasonDay } from "../calendar/season-calendar";
import type { Commitment, Target } from "../commitment/commitment";
import { targetOf } from "../commitment/commitment";
import type { Entry } from "../entry/entry";
import type { SessionResult } from "./per-session";
import { specificDaysSessions, timesPerWeekSessions } from "./per-session";

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
 * @throws {RangeError} if `week` falls outside `season`'s length.
 * @throws {RangeError} if `commitment.schedule.period !== "perSession"` —
 * `weeklyTotal` dispatch arrives in slice 4.
 */
export function weekSessionsOf(
  commitment: Commitment,
  season: Season,
  week: number,
  weekEntries: readonly Entry[],
): readonly SessionResult[] {
  assertValidSeasonDay(season, seasonDay(week * DAYS_PER_WEEK));
  if (commitment.schedule.period !== "perSession") {
    throw new RangeError('weekSessionsOf: only period="perSession" is handled before slice 4');
  }
  const target = targetOfCommitment(commitment);
  const { frequency } = commitment.schedule;
  if (frequency.kind === "timesPerWeek") {
    return timesPerWeekSessions(target, frequency.times, weekEntries);
  }
  return specificDaysSessions(target, season, week, frequency.weekdays, weekEntries);
}
