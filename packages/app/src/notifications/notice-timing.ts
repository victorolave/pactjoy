import type { Instant } from "../time/instant.ts";
import { epochDay, type LocalDate, localDateOfEpochDay } from "../time/local-date.ts";
import type { TimeZone, TimeZoneId } from "../time/time-zone.port.ts";

/**
 * When notices may go out (ADR-0017), always in the season's timezone (there is no per-member
 * one): calendar notices at 09:00 until 22:00, and nothing during the quiet hours 22:00-08:00.
 */

/** 09:00: when a calendar ("morning") notice is first sent. */
export const MORNING_MINUTE = 9 * 60;
/** 22:00: a morning notice not sent by then expires (or rolls over once); quiet hours start. */
export const EVENING_MINUTE = 22 * 60;
/** 08:00: quiet hours end. */
export const QUIET_END_MINUTE = 8 * 60;

export function addDays(date: LocalDate, days: number): LocalDate {
  return localDateOfEpochDay(epochDay(date) + days);
}

export interface NoticeWindow {
  readonly notBefore: Instant;
  readonly expiresAt: Instant;
}

/** 09:00 to 22:00 season-local on `date`. */
export function morningWindow(date: LocalDate, zone: TimeZoneId, timeZone: TimeZone): NoticeWindow {
  return {
    notBefore: timeZone.instantAt(date, MORNING_MINUTE, zone),
    expiresAt: timeZone.instantAt(date, EVENING_MINUTE, zone),
  };
}

/** Whether `now` is inside 09:00-22:00 season-local, the only time the planner adds calendar notices. */
export function inPlanningWindow(now: Instant, zone: TimeZoneId, timeZone: TimeZone): boolean {
  const { minuteOfDay } = timeZone.localTimeAt(now, zone);
  return minuteOfDay >= MORNING_MINUTE && minuteOfDay < EVENING_MINUTE;
}

/** When the quiet hours `now` falls in end (the next 08:00 season-local), or `null` outside them. */
export function quietHoursEnd(now: Instant, zone: TimeZoneId, timeZone: TimeZone): Instant | null {
  const { date, minuteOfDay } = timeZone.localTimeAt(now, zone);
  if (minuteOfDay >= EVENING_MINUTE) {
    return timeZone.instantAt(addDays(date, 1), QUIET_END_MINUTE, zone);
  }
  if (minuteOfDay < QUIET_END_MINUTE) return timeZone.instantAt(date, QUIET_END_MINUTE, zone);
  return null;
}
