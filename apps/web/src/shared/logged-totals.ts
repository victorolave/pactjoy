import type { TodayRow } from "@pactjoy/app";
import { toScaled } from "./decimal.ts";

/** Quantities the viewer already logged for the day the row describes, scaled x100. */
export function loggedToday(row: TodayRow, refDate: string | undefined): bigint {
  return row.entries.reduce((total, entry) => {
    if (entry.value.kind !== "quantity") return total;
    if (refDate !== undefined && entry.forDate !== refDate) return total;
    return total + (toScaled(entry.value.value) ?? 0n);
  }, 0n);
}

/** What the week has so far for a week row (the server's own sum), scaled x100. */
export function loggedThisWeek(row: TodayRow): bigint {
  if (row.kind !== "week" || row.progress?.value == null) return 0n;
  return toScaled(row.progress.value) ?? 0n;
}

/**
 * What is already logged in the opportunity a new registro adds to: the whole week for a weekly
 * total, the day's entries for everything else. Display figure only: the server scores.
 */
export function loggedBefore(row: TodayRow, refDate: string | undefined): bigint {
  const weekly = row.measure.unit !== "done" && row.measure.schedule.period === "weeklyTotal";
  return weekly ? loggedThisWeek(row) : loggedToday(row, refDate);
}
