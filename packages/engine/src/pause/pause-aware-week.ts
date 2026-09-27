/**
 * The pause-aware composition point: one commitment's one week, with pause
 * (`effectivePausedDays`/`pendingHoldDays`), D6/D7 proration and D8's
 * paused-day exclusion all applied before delegating to the existing,
 * unchanged `timesPerWeekSessions`/`specificDaysSessions`/
 * `weeklyTotalResult`. A rejection's grace extension is passed down as a
 * `GraceDeadlineFor` override (see `entry/grace-period.ts`) — an entry's
 * own `recordedOn` is never read or rewritten here. This is the single
 * place that composes pause with opportunity generation — callers
 * (acceptance tests, and eventually `scoring/member-score.ts`, slice 6a)
 * must not re-implement any of this themselves.
 */

import type { Season, SeasonDay } from "../calendar/season-calendar";
import { seasonDay } from "../calendar/season-calendar";
import type { Commitment } from "../commitment/commitment";
import { targetOf } from "../commitment/commitment";
import type { Entry } from "../entry/entry";
import type { GraceDeadlineFor } from "../entry/grace-period";
import { graceDeadline } from "../entry/grace-period";
import type { SessionResult } from "../opportunity/per-session";
import {
  dayForWeekday,
  specificDaysSessions,
  timesPerWeekSessions,
} from "../opportunity/per-session";
import { weeklyTotalResult } from "../opportunity/weekly-total";
import type { PauseRequest } from "./pause";
import { effectivePausedDays, pendingHoldDays } from "./pause";
import { prorateLimitTarget, prorateReachTarget, prorateSessionCount } from "./proration";

const DAYS_PER_WEEK = 7;

export type PauseAwareWeekResult =
  | { readonly status: "scored"; readonly sessions: readonly SessionResult[] }
  /** D7/P-A: the governing figure (N, ideal, tolerance, or every scheduled day) is excluded, driven ONLY by approved pauses. */
  | { readonly status: "paused" }
  /** R4a/P-C: excluded because a pending request is involved — alone, or mixed with an approved pause (its result can still change). */
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
 * P-C (decision round 3, engine-authored): the days that drove the
 * exclusion decide the status — a mix of paused AND on-hold days reports
 * `"onHold"`, since a still-pending request means the result can still
 * change once it's decided; only an exclusion driven entirely by approved
 * pauses (no pending request involved at all) reports `"paused"`.
 */
function excludedStatus(
  paused: ReadonlySet<SeasonDay>,
  onHold: ReadonlySet<SeasonDay>,
  days: readonly SeasonDay[],
): PauseAwareWeekResult {
  const anyPaused = days.some((d) => paused.has(d));
  const anyOnHold = days.some((d) => onHold.has(d));
  return anyPaused && !anyOnHold ? { status: "paused" } : { status: "onHold" };
}

/**
 * One commitment's one week, pause-aware. `pauses` and `entries` must
 * already be scoped to this commitment (same convention as `weekEntries`
 * elsewhere). `season` is only needed for `specificDays` (to resolve its
 * scheduled weekdays into days); `timesPerWeek`/`weeklyTotal` ignore it.
 *
 * P-A (decision round 3, engine-authored): a `specificDays` scheduled day
 * that falls on a paused or on-hold day drops out of the week's
 * opportunities entirely (no proration, unlike `timesPerWeek`/`weeklyTotal`)
 * — so an extra entry on another day can never "cover" it (D5 only ever
 * looks at the remaining, still-scheduled days). If every scheduled day is
 * excluded, the whole week reports `excludedStatus` (P-C decides paused vs
 * onHold) instead of scoring zero opportunities.
 */
export function pauseAwareWeekSessions(
  commitment: Commitment,
  week: number,
  pauses: readonly PauseRequest[],
  entries: readonly Entry[],
  today: SeasonDay,
  season?: Season,
): PauseAwareWeekResult {
  const weekStart = week * DAYS_PER_WEEK;
  const weekDays: readonly SeasonDay[] = Array.from({ length: DAYS_PER_WEEK }, (_, i) =>
    seasonDay(weekStart + i),
  );

  const paused = effectivePausedDays(pauses, today);
  const onHold = pendingHoldDays(pauses, today);
  const excluded = (day: SeasonDay): boolean => paused.has(day) || onHold.has(day);

  let activeDays = 0;
  for (const day of weekDays) {
    if (!excluded(day)) activeDays++;
  }

  // D8: an entry recorded on a paused OR on-hold day never reaches the underlying dispatcher.
  const eligible = entries.filter((entry) => !excluded(entry.day));
  const target = commitment.unit === "done" ? targetOf(commitment) : commitment.target;

  if (commitment.schedule.period === "weeklyTotal") {
    const prorated =
      target.direction === "reach"
        ? prorateReachTarget(target, activeDays)
        : prorateLimitTarget(target, activeDays);
    if (prorated === null) return excludedStatus(paused, onHold, weekDays);
    const deadlineFor: GraceDeadlineFor = (end) =>
      rejectionExtendedDeadline(pauses, weekStart, end, graceDeadline(end));
    return {
      status: "scored",
      sessions: [weeklyTotalResult(prorated, week, eligible, deadlineFor)],
    };
  }

  const { frequency } = commitment.schedule;
  if (frequency.kind === "timesPerWeek") {
    const n = prorateSessionCount(frequency.times, activeDays);
    if (n === null) return excludedStatus(paused, onHold, weekDays);
    const deadlineFor: GraceDeadlineFor = (day) =>
      rejectionExtendedDeadline(pauses, day, day, graceDeadline(day));
    return { status: "scored", sessions: timesPerWeekSessions(target, n, eligible, deadlineFor) };
  }

  // frequency.kind === "specificDays"
  if (!season) {
    throw new RangeError("pauseAwareWeekSessions: specificDays requires a `season` argument");
  }
  const scheduledDays = frequency.weekdays.map((weekday) => dayForWeekday(season, week, weekday));
  const activeWeekdays = frequency.weekdays.filter((weekday) => {
    const day = dayForWeekday(season, week, weekday);
    return !excluded(day);
  });
  if (activeWeekdays.length === 0) return excludedStatus(paused, onHold, scheduledDays);
  return {
    status: "scored",
    sessions: specificDaysSessions(target, season, week, activeWeekdays, eligible),
  };
}
