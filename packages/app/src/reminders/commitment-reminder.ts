import type { CommitmentId, MemberId, Weekday } from "@pactjoy/engine";
import type { CommitmentRecord } from "../commitment/commitment.ts";
import type { SeasonId } from "../shared/ids.ts";
import type { Instant } from "../time/instant.ts";

/**
 * The owner's reminder for one of their commitments (ADR-0017 addendum, D2, design J17): its own
 * small aggregate, never part of the pact. Changing it bumps only its own `version`: never
 * `pactRevision`, `season.version` or an approval, and it is not a scoring input (REQ-R2).
 * Owner-only: only `src/reminders/` reads the store (`reminder-guard.test.ts`).
 */
export interface CommitmentReminder {
  readonly seasonId: SeasonId;
  readonly commitmentId: CommitmentId;
  /** The commitment's owner, the only one who may read or change it and its only recipient. */
  readonly memberId: MemberId;
  readonly enabled: boolean;
  /** Season-local time, minutes after midnight: 08:00-21:45 in 15-minute steps. */
  readonly minuteOfDay: number;
  /** The days it fires on (engine weekdays, 0 = Sunday), distinct and sorted. */
  readonly weekdays: readonly Weekday[];
  readonly updatedAt: Instant;
  readonly version: number;
}

/** 08:00: the earliest reminder (quiet hours end). */
export const FIRST_REMINDER_MINUTE = 8 * 60;
/** 21:45: the latest reminder, so its hour of validity ends by the 22:00 quiet hours. */
export const LAST_REMINDER_MINUTE = 21 * 60 + 45;
export const REMINDER_STEP_MINUTES = 15;
/** 20:00, the owner's default (D2 decision). */
export const DEFAULT_REMINDER_MINUTE = 20 * 60;
/** A reminder not sent within this long after its time is dropped, never sent late (REQ-R7). */
export const REMINDER_VALIDITY_MINUTES = 60;

export const ALL_WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/** The days a commitment can be reminded on: its scheduled days, or every day. */
export function reminderDaysOf(commitment: CommitmentRecord): readonly Weekday[] {
  const { schedule } = commitment.measure;
  if (schedule.period === "perSession" && schedule.frequency.kind === "specificDays") {
    return [...schedule.frequency.weekdays].sort((a, b) => a - b);
  }
  return ALL_WEEKDAYS;
}

/** What the owner sees before ever saving one: off, at 20:00, on every day it can fire. */
export function defaultReminderSetting(commitment: CommitmentRecord): ReminderSetting {
  return {
    enabled: false,
    minuteOfDay: DEFAULT_REMINDER_MINUTE,
    weekdays: reminderDaysOf(commitment),
  };
}

/** The part of a reminder its owner chooses. */
export interface ReminderSetting {
  readonly enabled: boolean;
  readonly minuteOfDay: number;
  readonly weekdays: readonly Weekday[];
}

export type InvalidReminderReason = "time" | "weekdays" | "noWeekdays" | "notScheduled";

/**
 * Why a setting cannot be stored for `commitment`, or `null` (REQ-R3): a time off the 08:00-21:45
 * 15-minute grid; weekdays that are not distinct whole days 0-6; none while enabled; or a day the
 * commitment has no session on (a `specificDays` one only fires on its own days).
 */
export function invalidReminderReason(
  setting: ReminderSetting,
  commitment: CommitmentRecord,
): InvalidReminderReason | null {
  const { minuteOfDay, weekdays } = setting;
  if (
    !Number.isInteger(minuteOfDay) ||
    minuteOfDay < FIRST_REMINDER_MINUTE ||
    minuteOfDay > LAST_REMINDER_MINUTE ||
    minuteOfDay % REMINDER_STEP_MINUTES !== 0
  ) {
    return "time";
  }
  if (
    !weekdays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) ||
    new Set(weekdays).size !== weekdays.length
  ) {
    return "weekdays";
  }
  if (setting.enabled && weekdays.length === 0) return "noWeekdays";
  const allowed = new Set<number>(reminderDaysOf(commitment));
  if (!weekdays.every((day) => allowed.has(day))) return "notScheduled";
  return null;
}
