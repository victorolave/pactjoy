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
 *
 * E15 (D9's auto-resume-at-cap): the commitment's approved-paused days are
 * always trimmed to the earliest `cap` days (`pause-cap.ts`'s
 * `capPausedDays`) before anything else runs — a day beyond the cap is
 * simply no longer paused, which is what "the pause auto-resumes" means for
 * scoring, with no `resumedOn` ever synthesized. `cap` defaults to
 * `seasonPauseCap(options.season)` — scoring always happens inside a
 * season, so the cap is never optional; `options.pauseCap` exists only to
 * override that default (tests, or an explicit product exception), never to
 * skip the rule. `options.season` is REQUIRED (not just for `specificDays`
 * weekday resolution) precisely so a caller cannot forget it and silently
 * get an uncapped pause — the compiler enforces D9, not a caller's memory.
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
import { capPausedDays, seasonPauseCap } from "./pause-cap";
import { prorateLimitTarget, prorateReachTarget, prorateSessionCount } from "./proration";

const DAYS_PER_WEEK = 7;

export type PauseAwareWeekResult =
  | { readonly status: "scored"; readonly sessions: readonly SessionResult[] }
  /** D7/P-A: the governing figure (N, ideal, tolerance, or every scheduled day) is excluded, driven ONLY by approved pauses. */
  | { readonly status: "paused" }
  /** R4a/P-C: excluded because a pending request is involved — alone, or mixed with an approved pause (its result can still change). */
  | { readonly status: "onHold" };

/**
 * The union of approved-paused (D9 cap-trimmed) and still-pending ("on
 * hold") days for one commitment, as of `today` — exactly the `excluded`
 * predicate's day set this file already computes internally, exported so a
 * caller outside the pause composition itself (R1's "so far" counting,
 * `scoring/member-score.ts`, slice 6b) can tell which of a commitment's
 * scheduled days are excluded without duplicating the D9-cap-then-union
 * logic. Options mirror {@link pauseAwareWeekSessions}'s own.
 */
export function excludedDays(
  pauses: readonly PauseRequest[],
  today: SeasonDay,
  options: { readonly season: Season; readonly pauseCap?: number },
): ReadonlySet<SeasonDay> {
  const cap = options.pauseCap ?? seasonPauseCap(options.season);
  const paused = capPausedDays(effectivePausedDays(pauses, today), cap);
  const onHold = pendingHoldDays(pauses, today);
  return new Set([...paused, ...onHold]);
}

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
 * elsewhere). `options.season` is REQUIRED for every schedule kind — it
 * resolves `specificDays`' scheduled weekdays into days, AND it's the
 * default source of the D9 pause cap (`seasonPauseCap`) for every kind,
 * including `timesPerWeek`/`weeklyTotal`, which otherwise ignore it.
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
  options: { readonly season: Season; readonly pauseCap?: number },
): PauseAwareWeekResult {
  const weekStart = week * DAYS_PER_WEEK;
  const weekDays: readonly SeasonDay[] = Array.from({ length: DAYS_PER_WEEK }, (_, i) =>
    seasonDay(weekStart + i),
  );

  const cap = options.pauseCap ?? seasonPauseCap(options.season);
  const paused = capPausedDays(effectivePausedDays(pauses, today), cap);
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
  const scheduledDays = frequency.weekdays.map((weekday) =>
    dayForWeekday(options.season, week, weekday),
  );
  const activeWeekdays = frequency.weekdays.filter((weekday) => {
    const day = dayForWeekday(options.season, week, weekday);
    return !excluded(day);
  });
  if (activeWeekdays.length === 0) return excludedStatus(paused, onHold, scheduledDays);
  return {
    status: "scored",
    sessions: specificDaysSessions(target, options.season, week, activeWeekdays, eligible),
  };
}
