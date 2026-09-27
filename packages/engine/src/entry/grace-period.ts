/**
 * The grace period: a closed period (a `perSession` day or a `weeklyTotal`
 * week) still accepts entries until the end of the day following its close.
 * Entries logged after that deadline are rejected for the closed period.
 */
import type { SeasonDay } from "../calendar/season-calendar";
import { seasonDay } from "../calendar/season-calendar";
import type { Entry } from "./entry";

const GRACE_DAYS = 1;

/** The last day an entry for a period ending on `periodEnd` is still accepted. */
export function graceDeadline(periodEnd: SeasonDay): SeasonDay {
  return seasonDay(periodEnd + GRACE_DAYS);
}

/**
 * A pluggable grace-deadline policy: given the period's own end day (a
 * single day for `timesPerWeek`/`specificDays`, the week's last day for
 * `weeklyTotal`), returns its deadline. Every dispatch function defaults
 * this to {@link graceDeadline} itself, so existing callers are unaffected.
 * `pause/pause-aware-week.ts` is the only caller that overrides it, to
 * extend grace after a rejection — without ever touching an entry's own
 * `recordedOn`.
 */
export type GraceDeadlineFor = (periodEnd: SeasonDay) => SeasonDay;

/** Whether `entry` was recorded on or before `deadline`. */
export function isOnTime(entry: Entry, deadline: SeasonDay): boolean {
  return entry.recordedOn <= deadline;
}
