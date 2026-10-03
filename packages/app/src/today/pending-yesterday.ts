import type { CommitmentId, SeasonDay } from "@pactjoy/engine";
import { weekOf, weekProgress } from "@pactjoy/engine";
import { commitmentToEngine } from "../commitment/to-engine.ts";
import {
  checkEntryWindow,
  entryWindowDeadline,
  PAUSE_GRACE_EXTENSION_DAYS,
} from "../entry/entry-window.ts";
import type { MeasureView } from "../score/commitment-projection.ts";
import { projectMeasure } from "../score/commitment-projection.ts";
import { startWeekdayOf, toEngineEntry } from "../score/score-input.ts";
import type { LocalDate } from "../time/local-date.ts";
import {
  activeOpportunities,
  dateOfDay,
  limitPercentsOf,
  perOpportunityViews,
  type TodayPoints,
  type TodayRowsInput,
} from "./today-rows.ts";

/**
 * One day-bound opportunity of YESTERDAY the viewer can still register (design 15d "De ayer"):
 * nothing logged for it, its grace period is open today, it was not paused or on hold. Only the
 * viewer's own commitments ever appear.
 */
export interface PendingYesterdayItem {
  readonly commitmentId: CommitmentId;
  readonly habitName: string;
  readonly privacy: "visible" | "private";
  readonly measure: MeasureView;
  /** Yesterday, the day the registro would count for. */
  readonly forDate: LocalDate;
  /** Last day (inclusive) it can still be registered: today. */
  readonly graceUntil: LocalDate;
  /** `earned` is always `null` here (nothing is logged); the rest drives the sheet like a row's. */
  readonly points: TodayPoints;
}

/**
 * Day-bound (`specificDays`) opportunities of yesterday that are still open to register, from the
 * same engine and window rules Today's rows use: scheduled yesterday, no value counted for that slot
 * (an own entry, a "Hoy no salió" or a make-up from the week all count), `checkEntryWindow` open
 * today, not paused or on hold, inside the season. Week-bound opportunities (`timesPerWeek`,
 * `weeklyTotal`) never qualify, and nothing is pending once the season has ended: the rows then
 * already describe its last day.
 */
export function pendingYesterday(input: TodayRowsInput): readonly PendingYesterdayItem[] {
  const { season, actualStart, today, refDay } = input;
  const yesterday = (today - 1) as SeasonDay;
  const lastDay = season.lengthWeeks * 7 - 1;
  // Ended: today is past the last day. Yesterday would be before the season on day 0.
  if (today > lastDay || yesterday < 0) return [];

  const habitNames = new Map(input.habits.map((habit) => [habit.id, habit.name]));
  const engineSeason = {
    lengthWeeks: season.lengthWeeks,
    startWeekday: startWeekdayOf(actualStart),
  };
  const weekday = startWeekdayOf(dateOfDay(actualStart, yesterday));
  const engineEntries = input.entries.map(toEngineEntry);

  return input.commitments.flatMap((commitment): PendingYesterdayItem[] => {
    const { schedule } = commitment.measure;
    if (schedule.period !== "perSession" || schedule.frequency.kind !== "specificDays") return [];
    if (!schedule.frequency.weekdays.includes(weekday)) return [];
    if (
      checkEntryWindow({
        schedule,
        day: yesterday,
        today,
        lengthWeeks: season.lengthWeeks,
        pauseGraceExtensionDays: PAUSE_GRACE_EXTENSION_DAYS,
      }) !== null
    ) {
      return [];
    }
    const habitName = habitNames.get(commitment.habitId);
    if (habitName === undefined) {
      throw new Error(`habit ${commitment.habitId} of commitment ${commitment.id} not found`);
    }
    const engineCommitment = commitmentToEngine(commitment);
    const entries = engineEntries.filter((entry) => entry.commitmentId === commitment.id);
    const pauses = input.pauses.filter((pause) => pause.commitmentId === commitment.id);
    const weekAt = (week: number) =>
      weekProgress({
        season: engineSeason,
        commitment: engineCommitment,
        week,
        entries,
        pauses,
        today: refDay,
      });
    const progress = weekAt(weekOf(yesterday));
    // A paused or on-hold yesterday has no opportunity to register.
    if (progress.status !== "scored") return [];
    if (progress.excluded.paused.includes(yesterday)) return [];
    if (progress.excluded.onHold.includes(yesterday)) return [];
    // A value already counted for yesterday's slot (own entry, "Hoy no salió" or a make-up) is not pending.
    const slot = progress.slots.find((candidate) => candidate.day === yesterday);
    if (slot === undefined || slot.value !== null) return [];
    if (
      input.entries.some((entry) => entry.commitmentId === commitment.id && entry.day === yesterday)
    ) {
      return [];
    }
    const opportunities = activeOpportunities(season.lengthWeeks, weekAt);
    return [
      {
        commitmentId: commitment.id,
        habitName,
        privacy: commitment.privacy,
        measure: projectMeasure(commitment.measure),
        forDate: dateOfDay(actualStart, yesterday),
        graceUntil: dateOfDay(
          actualStart,
          entryWindowDeadline(schedule, yesterday, PAUSE_GRACE_EXTENSION_DAYS),
        ),
        points: {
          ...perOpportunityViews(engineCommitment, opportunities),
          earned: null,
          limitPercents: limitPercentsOf(commitment, engineCommitment),
        },
      },
    ];
  });
}
