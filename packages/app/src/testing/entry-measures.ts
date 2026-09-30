import { fromInt } from "@pactjoy/engine";
import type { Measure } from "../commitment/commitment.ts";
import { type LocalDate, localDate } from "../time/local-date.ts";

/** Season day `n` of the entry fixtures' season (day 0 is 2026-10-01, see `SEASON_START`). */
export function dayOf(n: number): LocalDate {
  return localDate(`2026-10-${String(1 + n).padStart(2, "0")}`);
}

/** Reach, minutes, every weekday: a day-bound opportunity per day. */
export const PER_DAY_REACH: Measure = {
  unit: "minutes",
  customLabel: null,
  precision: "decimal",
  target: { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) },
  schedule: {
    period: "perSession",
    frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
  },
};

/** Reach, minutes, the whole week is one opportunity. */
export const WEEKLY_TOTAL: Measure = { ...PER_DAY_REACH, schedule: { period: "weeklyTotal" } };

/** Reach, minutes, 3 sessions a week on any day (week-bound window, B8). */
export const TIMES_PER_WEEK: Measure = {
  ...PER_DAY_REACH,
  schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
};

/** Limit, integer `times`, every weekday. */
export const LIMIT: Measure = {
  unit: "times",
  customLabel: null,
  precision: "integer",
  target: { direction: "limit", ideal: fromInt(2), tolerance: fromInt(4) },
  schedule: PER_DAY_REACH.schedule,
};
