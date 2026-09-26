/**
 * The pause-aware composition point: one commitment's one week, with pause
 * (`effectivePausedDays`/`pendingHoldDays`), D6/D7 proration, D8's
 * paused-day exclusion, and a rejection's grace extension all applied
 * BEFORE delegating to the existing, unchanged
 * `timesPerWeekSessions`/`weeklyTotalResult`. This is the single place that
 * composes pause with opportunity generation — callers (acceptance tests,
 * and eventually `scoring/member-score.ts`, slice 6a) must not re-implement
 * any of this themselves.
 */

import type { SeasonDay } from "../calendar/season-calendar";
import { seasonDay } from "../calendar/season-calendar";
import type { Commitment } from "../commitment/commitment";
import { targetOf } from "../commitment/commitment";
import type { Entry } from "../entry/entry";
import { graceDeadline } from "../entry/grace-period";
import type { SessionResult } from "../opportunity/per-session";
import { timesPerWeekSessions } from "../opportunity/per-session";
import { weeklyTotalResult } from "../opportunity/weekly-total";
import type { PauseRequest } from "./pause";
import { effectivePausedDays, pendingHoldDays } from "./pause";
import { prorateLimitTarget, prorateReachTarget, prorateSessionCount } from "./proration";

const DAYS_PER_WEEK = 7;

export type PauseAwareWeekResult =
  | { readonly status: "scored"; readonly sessions: readonly SessionResult[] }
  /** D7: the governing figure (N, ideal, or tolerance) prorated to 0 — driven by at least one approved pause. */
  | { readonly status: "paused" }
  /** R4a: excluded because a pending request covers it, with no approved pause involved. */
  | { readonly status: "onHold" };

/**
 * A rejection extends the grace deadline of the opportunities it affected —
 * every day from its `startDay` through its `decidedOn` (the days that were
 * "en espera" before the decision arrived) — to the end of the day after the
 * rejection. `rangeStart`/`rangeEnd` describe the opportunity being
 * evaluated: a single day for `timesPerWeek`, the whole week for
 * `weeklyTotal` (whose deadline is shared across every entry in it).
 */
function rejectionExtendedDeadline(
  pauses: readonly PauseRequest[],
  rangeStart: number,
  rangeEnd: number,
  normal: SeasonDay,
): SeasonDay {
  let extended: SeasonDay = normal;
  for (const pause of pauses) {
    if (pause.decision.kind !== "rejected") continue;
    const overlaps = pause.startDay <= rangeEnd && pause.decision.decidedOn >= rangeStart;
    if (!overlaps) continue;
    const candidate = seasonDay(pause.decision.decidedOn + 1);
    if (candidate > extended) extended = candidate;
  }
  return extended;
}

/**
 * Clamps `entry.recordedOn` down to `normal` when it falls strictly between
 * `normal` and `extended` — this is what actually "extends" grace without
 * touching `isOnTime`/`weeklyTotalResult`/`timesPerWeekSessions`: those
 * functions still apply their own unchanged, un-extended deadline check,
 * and now see a `recordedOn` that already satisfies it.
 */
function withExtendedGrace(entry: Entry, normal: SeasonDay, extended: SeasonDay): Entry {
  if (extended > normal && entry.recordedOn > normal && entry.recordedOn <= extended) {
    return { ...entry, recordedOn: normal };
  }
  return entry;
}

function excludedStatus(
  paused: ReadonlySet<SeasonDay>,
  weekStart: number,
  weekEnd: number,
): PauseAwareWeekResult {
  for (let d = weekStart; d <= weekEnd; d++) {
    if (paused.has(seasonDay(d))) return { status: "paused" };
  }
  return { status: "onHold" };
}

/**
 * One commitment's one week, pause-aware. `pauses` and `entries` must
 * already be scoped to this commitment (same convention as `weekEntries`
 * elsewhere). `specificDays` + pause is out of scope for this slice (no
 * acceptance row needs it) and throws rather than silently ignoring pause.
 */
export function pauseAwareWeekSessions(
  commitment: Commitment,
  week: number,
  pauses: readonly PauseRequest[],
  entries: readonly Entry[],
  today: SeasonDay,
): PauseAwareWeekResult {
  const weekStart = week * DAYS_PER_WEEK;
  const weekEnd = weekStart + DAYS_PER_WEEK - 1;

  const paused = effectivePausedDays(pauses, today);
  const onHold = pendingHoldDays(pauses, today);
  const excluded = (day: SeasonDay): boolean => paused.has(day) || onHold.has(day);

  let activeDays = 0;
  for (let d = weekStart; d <= weekEnd; d++) {
    if (!excluded(seasonDay(d))) activeDays++;
  }

  // D8: an entry recorded on a paused OR on-hold day never reaches the underlying dispatcher.
  const eligible = entries.filter((entry) => !excluded(entry.day));
  const target = commitment.unit === "done" ? targetOf(commitment) : commitment.target;

  if (commitment.schedule.period === "weeklyTotal") {
    const prorated =
      target.direction === "reach"
        ? prorateReachTarget(target, activeDays)
        : prorateLimitTarget(target, activeDays);
    if (prorated === null) return excludedStatus(paused, weekStart, weekEnd);
    const normal = graceDeadline(seasonDay(weekEnd));
    const extended = rejectionExtendedDeadline(pauses, weekStart, weekEnd, normal);
    const graced = eligible.map((entry) => withExtendedGrace(entry, normal, extended));
    return { status: "scored", sessions: [weeklyTotalResult(prorated, week, graced)] };
  }

  const { frequency } = commitment.schedule;
  if (frequency.kind === "timesPerWeek") {
    const n = prorateSessionCount(frequency.times, activeDays);
    if (n === null) return excludedStatus(paused, weekStart, weekEnd);
    const graced = eligible.map((entry) => {
      const normal = graceDeadline(entry.day);
      const extended = rejectionExtendedDeadline(pauses, entry.day, entry.day, normal);
      return withExtendedGrace(entry, normal, extended);
    });
    return { status: "scored", sessions: timesPerWeekSessions(target, n, graced) };
  }

  throw new RangeError(
    "pauseAwareWeekSessions: specificDays + pause is not supported yet — no acceptance row needs it in slice 5a",
  );
}
