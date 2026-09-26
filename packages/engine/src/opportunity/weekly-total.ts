/**
 * `weeklyTotal` opportunity generation: the whole week is one opportunity.
 * Entries accumulate across the week (`sumEntryValues` — see `per-session.ts`)
 * and only entries on time for the week's own close+grace deadline count
 * (the design's data flow: `entries → isOnTime → assign`, the same shared
 * pattern slice 3 proved in `per-session.ts`'s `groupByDay`). A late entry
 * is attributed to the week it was meant for: `weekEntries` arrives already
 * filtered to this commitment and this week by `entry.day` (the caller's
 * job, same contract as `per-session.ts`), never to the week it happened to
 * be logged in.
 *
 * Each call only ever sees its own week's entries and carries no state
 * across calls, so non-compensation (excess progress in one week never
 * offsets another) falls out of that statelessness — there is no separate
 * rule to implement.
 */
import { seasonDay } from "../calendar/season-calendar";
import type { Target } from "../commitment/commitment";
import type { Entry } from "../entry/entry";
import { graceDeadline, isOnTime } from "../entry/grace-period";
import { isConsistent, progressOf } from "../progress/progress";
import type { SessionResult } from "./per-session";
import { sumEntryValues } from "./per-session";

const DAYS_PER_WEEK = 7;

/**
 * The week's single `weeklyTotal` opportunity outcome: every on-time entry
 * in `weekEntries` summed into one value, or `null` if none were on time
 * (including "no entries at all") — `null` and an explicit recorded `0`
 * are distinguished the same way `per-session.ts` distinguishes them (C13
 * vs C14): a recorded zero still produces a non-null value.
 *
 * **Contract — pure and calendar-agnostic.** This function has no notion of
 * "today": it returns a result for *whatever* `week` is asked for, whether
 * or not that week has actually closed yet (it only ever gates on grace
 * relative to `week`'s own end, never on the current date). A `0` progress
 * for a week that's still open is **not** the same as a `0` that should
 * count toward consistency or points — it simply reflects "nothing entered
 * so far," not "this week is scored as a miss." Deciding *which* weeks are
 * closed enough to include in an aggregate ("so far", R1) is the
 * aggregator's job (slice 6b), not this function's.
 */
export function weeklyTotalResult(
  target: Target,
  week: number,
  weekEntries: readonly Entry[],
): SessionResult {
  const weekEnd = seasonDay(week * DAYS_PER_WEEK + (DAYS_PER_WEEK - 1));
  const deadline = graceDeadline(weekEnd);
  const onTime = weekEntries.filter((entry) => isOnTime(entry, deadline));
  const value = onTime.length === 0 ? null : sumEntryValues(onTime);
  return { value, progress: progressOf(target, value), consistent: isConsistent(target, value) };
}
