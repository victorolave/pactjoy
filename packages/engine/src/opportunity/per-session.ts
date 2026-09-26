/**
 * Per-session opportunity generation for `Schedule.period === "perSession"`.
 * `timesPerWeek` here; `specificDays` follows in the same module (D5).
 */
import type { Target } from "../commitment/commitment";
import type { Entry } from "../entry/entry";
import { graceDeadline, isOnTime } from "../entry/grace-period";
import type { Fraction } from "../fraction/fraction";
import { compare, fromInt, sum } from "../fraction/fraction";
import { isConsistent, progressOf } from "../progress/progress";

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
 * Sums entries that all fall on the same day into one session value (D4).
 * Callers are responsible for grouping entries by day first — this function
 * does not itself check that `entries` share a day.
 */
export function sumSameDayEntries(entries: readonly Entry[]): Fraction {
  return sum(entries.map(entryValue));
}

/**
 * Groups entries by day, discarding any entry recorded after its own day's
 * grace deadline first (the design's data flow: `entries → isOnTime →
 * assign`) — a late entry never reaches D4's same-day sum or D5's
 * missed-day coverage.
 */
function groupByDay(entries: readonly Entry[]): Map<number, Entry[]> {
  const byDay = new Map<number, Entry[]>();
  for (const entry of entries) {
    if (!isOnTime(entry, graceDeadline(entry.day))) continue;
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
): readonly SessionResult[] {
  const sessionValues = [...groupByDay(weekEntries).values()].map(sumSameDayEntries);
  const scored = sessionValues
    .map((value) => toSessionResult(target, value))
    .sort((a, b) => compare(b.progress, a.progress));
  const best = scored.slice(0, times);
  const missing = times - best.length;
  return [...best, ...Array.from({ length: missing > 0 ? missing : 0 }, () => EMPTY_SESSION)];
}
