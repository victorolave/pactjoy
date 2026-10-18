import type { Weekday } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { buildCommitment, commitmentId, type Measure } from "../commitment/commitment.ts";
import { habitId } from "../shared/ids.ts";
import { PER_DAY_REACH, TIMES_PER_WEEK, WEEKLY_TOTAL } from "../testing/entry-measures.ts";
import {
  defaultReminderSetting,
  invalidReminderReason,
  type ReminderSetting,
  reminderDaysOf,
} from "./commitment-reminder.ts";

const commitmentWith = (measure: Measure) =>
  buildCommitment({
    id: commitmentId("c-1"),
    memberId: memberId("m-1"),
    habitId: habitId("h-1"),
    weightPercent: 100,
    privacy: "visible",
    measure,
  });

const MON_WED_FRI: Measure = {
  ...PER_DAY_REACH,
  schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [5, 1, 3] } },
};

const setting = (extra: Partial<ReminderSetting> = {}): ReminderSetting => ({
  enabled: true,
  minuteOfDay: 20 * 60,
  weekdays: [1, 3, 5],
  ...extra,
});

describe("reminder days and defaults (REQ-R1)", () => {
  it("a specificDays commitment is reminded on its own days, sorted", () => {
    expect(reminderDaysOf(commitmentWith(MON_WED_FRI))).toEqual([1, 3, 5]);
  });

  it("timesPerWeek and weeklyTotal commitments can be reminded on any day", () => {
    expect(reminderDaysOf(commitmentWith(TIMES_PER_WEEK))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(reminderDaysOf(commitmentWith(WEEKLY_TOTAL))).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("defaults to off at 20:00 on every day the commitment can fire (SC-R7)", () => {
    expect(defaultReminderSetting(commitmentWith(MON_WED_FRI))).toEqual({
      enabled: false,
      minuteOfDay: 1200,
      weekdays: [1, 3, 5],
    });
  });
});

describe("invalidReminderReason (REQ-R3)", () => {
  const c = commitmentWith(MON_WED_FRI);

  it("accepts 08:00 to 21:45 on the 15-minute grid", () => {
    for (const minuteOfDay of [480, 495, 1200, 1305]) {
      expect(invalidReminderReason(setting({ minuteOfDay }), c)).toBeNull();
    }
  });

  it("rejects a time off the grid or outside 08:00-21:45", () => {
    for (const minuteOfDay of [465, 1320, 1201, 1200.5, -15, Number.NaN]) {
      expect(invalidReminderReason(setting({ minuteOfDay }), c)).toBe("time");
    }
  });

  it("rejects repeated or impossible weekdays", () => {
    for (const weekdays of [[1, 1], [7], [-1], [1.5]] as unknown as Weekday[][]) {
      expect(invalidReminderReason(setting({ weekdays }), c)).toBe("weekdays");
    }
  });

  it("an enabled reminder needs a day; a disabled one may have none", () => {
    expect(invalidReminderReason(setting({ weekdays: [] }), c)).toBe("noWeekdays");
    expect(invalidReminderReason(setting({ enabled: false, weekdays: [] }), c)).toBeNull();
  });

  it("a specificDays commitment cannot be reminded on a day it has no session", () => {
    expect(invalidReminderReason(setting({ weekdays: [1, 2] }), c)).toBe("notScheduled");
    expect(
      invalidReminderReason(setting({ weekdays: [0, 2, 6] }), commitmentWith(TIMES_PER_WEEK)),
    ).toBeNull();
  });
});
