/**
 * Per-session opportunity generation for `Schedule.period === "perSession"`:
 * `timesPerWeek` (D4 same-day sum + best-N) and `specificDays` (D5 same-week
 * missed-day coverage).
 */
import type { Season, SeasonDay, Weekday } from "../calendar/season-calendar";
import { seasonDay } from "../calendar/season-calendar";
import type { Target } from "../commitment/commitment";
import type { Entry } from "../entry/entry";
import type { GraceDeadlineFor } from "../entry/grace-period";
import { graceDeadline, isOnTime } from "../entry/grace-period";
import type { Fraction } from "../fraction/fraction";
import { compare, fromInt, sum } from "../fraction/fraction";
import { isConsistent, progressOf } from "../progress/progress";

const DAYS_PER_WEEK = 7;

const ONE = fromInt(1);
const ZERO = fromInt(0);

/** One `perSession` opportunity's outcome: its raw (possibly summed) value and derived progress. */
export interface SessionResult {
  readonly value: Fraction | null;
  readonly progress: Fraction;
  readonly consistent: boolean;
}

function entryValue(entry: Entry): Fraction {
  if (entry.kind === "quantity") return entry.value;
  if (entry.kind === "done") return ONE;
  return ZERO; // "missed"
}

/**
 * Sums a list of entries into one value (via {@link entryValue}: quantity's
 * own value, `done` as 1, `missed` as 0). Used both for a single day's
 * same-day sum (D4, via `groupByDay`) and for a whole week's total
 * (`weekly-total.ts`'s `weeklyTotalResult`) — summation itself has no
 * notion of "day" or "week", only the caller decides which entries to pass.
 */
export function sumEntryValues(entries: readonly Entry[]): Fraction {
  return sum(entries.map(entryValue));
}

/**
 * Groups entries by day, discarding any entry recorded after its own day's
 * grace deadline first (the design's data flow: `entries → isOnTime →
 * assign`) — a late entry never reaches D4's same-day sum or D5's
 * missed-day coverage. `deadlineFor` defaults to {@link graceDeadline};
 * `pause/pause-aware-week.ts` overrides it to extend grace after a
 * rejection, without ever rewriting an entry's own `recordedOn`.
 */
function groupByDay(
  entries: readonly Entry[],
  deadlineFor: GraceDeadlineFor = graceDeadline,
): Map<number, Entry[]> {
  const byDay = new Map<number, Entry[]>();
  for (const entry of entries) {
    if (!isOnTime(entry, deadlineFor(entry.day))) continue;
    const existing = byDay.get(entry.day);
    if (existing) {
      existing.push(entry);
    } else {
      byDay.set(entry.day, [entry]);
    }
  }
  return byDay;
}

function toSessionResult(target: Target, value: Fraction | null): SessionResult {
  return { value, progress: progressOf(target, value), consistent: isConsistent(target, value) };
}

const EMPTY_SESSION: SessionResult = { value: null, progress: fromInt(0), consistent: false };

/**
 * The week's `timesPerWeek` opportunities: sessions may fall on any day
 * (same-day entries summed per D4), and when more than `times` sessions
 * occur, only the best `times` count (D4) — extras neither lower nor
 * duplicate the score. Always returns exactly `times` results, zero-filling
 * any unoccupied slot.
 */
export function timesPerWeekSessions(
  target: Target,
  times: number,
  weekEntries: readonly Entry[],
  deadlineFor: GraceDeadlineFor = graceDeadline,
): readonly SessionResult[] {
  const sessionValues = [...groupByDay(weekEntries, deadlineFor).values()].map(sumEntryValues);
  const scored = sessionValues
    .map((value) => toSessionResult(target, value))
    .sort((a, b) => compare(b.progress, a.progress));
  const best = scored.slice(0, times);
  const missing = times - best.length;
  return [...best, ...Array.from({ length: missing > 0 ? missing : 0 }, () => EMPTY_SESSION)];
}

/**
 * The {@link SeasonDay} that `weekday` falls on in week `week` of `season`.
 * Exported so `pause/pause-aware-week.ts` can resolve which of a
 * `specificDays` commitment's scheduled weekdays fall on a paused or
 * on-hold day (P-A), without duplicating this formula.
 */
export function dayForWeekday(season: Season, week: number, weekday: Weekday): SeasonDay {
  const offset = (weekday - season.startWeekday + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  return seasonDay(week * DAYS_PER_WEEK + offset);
}

/**
 * The week's `specificDays` opportunities: one per `scheduledWeekdays` entry.
 * An entry on a non-scheduled day covers a still-missing scheduled day from
 * the *same week only* (D5, in scheduled-day order), and never raises the
 * opportunity count above `scheduledWeekdays.length`; if nothing is missing,
 * it adds nothing.
 */
export function specificDaysSessions(
  target: Target,
  season: Season,
  week: number,
  scheduledWeekdays: readonly Weekday[],
  weekEntries: readonly Entry[],
  deadlineFor: GraceDeadlineFor = graceDeadline,
): readonly SessionResult[] {
  const byDay = groupByDay(weekEntries, deadlineFor);
  const scheduledDays = scheduledWeekdays.map((weekday) => dayForWeekday(season, week, weekday));
  const scheduledSet = new Set<number>(scheduledDays);
  const slotValues = new Map<number, Fraction | null>(
    scheduledDays.map((day) => [day, byDay.has(day) ? sumEntryValues(byDay.get(day) ?? []) : null]),
  );

  const extraDays = [...byDay.keys()].filter((day) => !scheduledSet.has(day)).sort((a, b) => a - b);
  for (const extraDay of extraDays) {
    const missingSlot = scheduledDays.find((day) => slotValues.get(day) === null);
    if (missingSlot === undefined) continue; // nothing missed this week — the extra entry adds nothing
    slotValues.set(missingSlot, sumEntryValues(byDay.get(extraDay) ?? []));
  }

  return scheduledDays.map((day) => toSessionResult(target, slotValues.get(day) ?? null));
}
