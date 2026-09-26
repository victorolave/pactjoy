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
import { specificDaysSessions, timesPerWeekSessions } from "../opportunity/per-session";
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
 * elsewhere). `season` is only needed for `specificDays` (to resolve its
 * scheduled weekdays into days); `timesPerWeek`/`weeklyTotal` ignore it.
 *
 * `specificDays` + an active pause or on-hold request is a pending product
 * decision (not yet answered) and throws rather than guessing; with no
 * exclusion at all for the week, it delegates straight to the existing
 * `specificDaysSessions` — so a plain, never-paused `specificDays`
 * commitment (e.g. "Dibujar") never crashes here.
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
    if (n === null) return excludedStatus(paused, weekStart, weekEnd);
    const deadlineFor: GraceDeadlineFor = (day) =>
      rejectionExtendedDeadline(pauses, day, day, graceDeadline(day));
    return { status: "scored", sessions: timesPerWeekSessions(target, n, eligible, deadlineFor) };
  }

  // frequency.kind === "specificDays"
  if (activeDays < DAYS_PER_WEEK) {
    throw new RangeError(
      "pauseAwareWeekSessions: specificDays + an active pause/on-hold request is a pending product decision — not implemented yet",
    );
  }
  if (!season) {
    throw new RangeError("pauseAwareWeekSessions: specificDays requires a `season` argument");
  }
  return {
    status: "scored",
    sessions: specificDaysSessions(target, season, week, frequency.weekdays, eligible),
  };
}
