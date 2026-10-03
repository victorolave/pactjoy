import type { CommitmentId, Fraction, SeasonDay, WeekProgress } from "@pactjoy/engine";
import {
  displayPercent,
  displayPoints,
  displayPointsDecimal,
  fromInt,
  gt,
  opportunityPointsAt,
  opportunityValue,
  progressAtValue,
  sumPoints,
  weekOf,
  weekProgress,
} from "@pactjoy/engine";
import type { CommitmentRecord } from "../commitment/commitment.ts";
import { commitmentToEngine } from "../commitment/to-engine.ts";
import type { EntryRecord } from "../entry/entry.ts";
import {
  checkEntryWindow,
  entryWindowDeadline,
  PAUSE_GRACE_EXTENSION_DAYS,
} from "../entry/entry-window.ts";
import type { Habit } from "../habit/habit.ts";
import type { MemberPauseRequest } from "../pause/pause-request.repository.ts";
import {
  type MeasureView,
  projectMeasure,
  projectTarget,
  type TargetView,
} from "../score/commitment-projection.ts";
import { startWeekdayOf, toEngineEntry } from "../score/score-input.ts";
import type { Season } from "../season/season.ts";
import { toDecimalString } from "../shared/decimal.ts";
import type { EntryId, HabitId } from "../shared/ids.ts";
import { epochDay, type LocalDate, localDateOfEpochDay } from "../time/local-date.ts";

/**
 * Where one opportunity stands for the viewer (TD-R6). Precedence:
 * `paused`/`onHold` > `closed` > `logged` > `open`.
 */
export type OpportunityState = "open" | "logged" | "closed" | "paused" | "onHold";

export interface TodayOpportunity {
  readonly state: OpportunityState;
  /** Last day (inclusive) the opportunity can still be logged or edited; `null` while paused or on hold. */
  readonly graceUntil: LocalDate | null;
}

/** One of MY entries that its window still allows me to change. */
export interface TodayEntry {
  readonly entryId: EntryId;
  /** The opportunity day the entry counts toward. */
  readonly forDate: LocalDate;
  readonly value:
    | { readonly kind: "done" }
    | { readonly kind: "missed" }
    | { readonly kind: "quantity"; readonly value: string };
  readonly note: string | null;
}

/** The week's figures for a `timesPerWeek` / `weeklyTotal` row; `null` while the whole week is paused or on hold. */
export interface TodayWeekProgress {
  /** Sum of what counted; `null` while nothing has been logged. */
  readonly value: string | null;
  /** The week's effective (prorated) thresholds. */
  readonly target: TargetView;
  readonly sessionsDone: number;
  readonly sessionsTarget: number;
  /** Mean progress of the week's opportunities, rounded for display. */
  readonly percent: number;
}

/**
 * What the row's opportunity is worth, computed by the engine (D12 cut to one
 * opportunity) so no client scores anything. Only display rounding happens here.
 */
export interface TodayPoints {
  /**
   * Points one opportunity of this commitment is worth at 100 %, two decimals
   * ("6.25"); `null` when the season has no active opportunity for it.
   */
  readonly perOpportunity: string | null;
  /**
   * The same value, exact: `numerator / denominator` as BigInt strings. A client previewing a draft
   * multiplies THIS and rounds once; multiplying the rounded `perOpportunity` would round twice.
   */
  readonly perOpportunityExact: { readonly numerator: string; readonly denominator: string } | null;
  /**
   * Whole points the opportunity's entries earned; `null` when nothing is logged, the opportunity
   * is paused or on hold, or it is not COUNTED yet: a week-bound opportunity (`timesPerWeek`,
   * `weeklyTotal`) counts from week close plus grace, as in the season score. A logged miss is `0`.
   */
  readonly earned: number | null;
  /**
   * Per-session limit counted in whole numbers only: the percent that logging
   * `n` scores, indexed by `n` from 0 to 12, so a client can show each option's
   * score before it is chosen. `null` for every other row.
   */
  readonly limitPercents: readonly number[] | null;
}

interface TodayRowBase {
  readonly commitmentId: CommitmentId;
  readonly habitName: string;
  readonly privacy: "visible" | "private";
  readonly measure: MeasureView;
  readonly opportunity: TodayOpportunity;
  readonly points: TodayPoints;
  readonly entries: readonly TodayEntry[];
}

/** One row per commitment OF THE VIEWER; other members' commitments never appear. */
export type TodayRow =
  | (TodayRowBase & { readonly kind: "day"; readonly scheduledToday: boolean })
  | (TodayRowBase & { readonly kind: "week"; readonly progress: TodayWeekProgress | null });

export interface TodayRowsInput {
  readonly season: Season;
  readonly actualStart: LocalDate;
  /** The viewer's own commitments, in season order. */
  readonly commitments: readonly CommitmentRecord[];
  readonly habits: readonly Habit[];
  readonly entries: readonly EntryRecord[];
  readonly pauses: readonly MemberPauseRequest[];
  /** The real current season day (may be past the last day once the season ended). */
  readonly today: SeasonDay;
  /** The day the rows describe: today, or the last season day once ended. */
  readonly refDay: SeasonDay;
}

export function dateOfDay(actualStart: LocalDate, day: number): LocalDate {
  return localDateOfEpochDay(epochDay(actualStart) + day);
}

function entryView(record: EntryRecord, actualStart: LocalDate): TodayEntry {
  const { value } = record;
  return {
    entryId: record.id,
    forDate: dateOfDay(actualStart, record.day),
    value:
      value.kind === "quantity"
        ? { kind: "quantity", value: toDecimalString(value.value) }
        : { kind: value.kind },
    note: record.note,
  };
}

function weekProgressView(week: Extract<WeekProgress, { status: "scored" }>): TodayWeekProgress {
  return {
    value: week.value === null ? null : toDecimalString(week.value),
    target: projectTarget(week.target),
    sessionsDone: week.sessionsDone,
    sessionsTarget: week.sessionsTarget,
    percent: displayPercent(week.progress),
  };
}

/** The highest whole number a limit row publishes a percent for (the grid never goes past it). */
const MAX_LIMIT_OPTION = 12;

/** Every active opportunity of the commitment across the season, pause-aware: D12's denominator. */
/** One opportunity's value as the two views the clients get: a 2-decimal display and the exact fraction. */
export function perOpportunityViews(
  engineCommitment: ReturnType<typeof commitmentToEngine>,
  opportunities: number,
): Pick<TodayPoints, "perOpportunity" | "perOpportunityExact"> {
  if (opportunities === 0) return { perOpportunity: null, perOpportunityExact: null };
  const value = opportunityValue(engineCommitment, opportunities);
  return {
    perOpportunity: displayPointsDecimal(value),
    perOpportunityExact: { numerator: value.num.toString(), denominator: value.den.toString() },
  };
}

export function activeOpportunities(weeks: number, weekAt: (week: number) => WeekProgress): number {
  let total = 0;
  for (let week = 0; week < weeks; week++) {
    const progress = weekAt(week);
    if (progress.status === "scored") total += progress.sessionsTarget;
  }
  return total;
}

export function limitPercentsOf(
  record: CommitmentRecord,
  engineCommitment: ReturnType<typeof commitmentToEngine>,
): readonly number[] | null {
  const { measure } = record;
  if (
    measure.unit === "done" ||
    measure.target.direction !== "limit" ||
    measure.precision !== "integer" ||
    measure.schedule.period !== "perSession"
  ) {
    return null;
  }
  // The table covers whole numbers 0..MAX_LIMIT_OPTION plus the open end one past the tolerance. A wider
  // tolerance has no complete table: it publishes none (the client then types the number instead of
  // picking it from a grid), never a table that stops short.
  if (gt(measure.target.tolerance, fromInt(MAX_LIMIT_OPTION - 1))) return null;
  return Array.from({ length: MAX_LIMIT_OPTION + 1 }, (_, option) =>
    displayPercent(progressAtValue(engineCommitment, fromInt(option))),
  );
}

function stateOf(
  week: WeekProgress,
  refDay: SeasonDay,
  closed: boolean,
  logged: boolean,
): OpportunityState {
  if (week.status !== "scored") return week.status;
  if (week.excluded.paused.includes(refDay)) return "paused";
  if (week.excluded.onHold.includes(refDay)) return "onHold";
  if (closed) return "closed";
  return logged ? "logged" : "open";
}

/**
 * The viewer's Today rows (TD-R4..R6): one per own commitment, from the same
 * `weekProgress` the score uses and the same entry window `recordEntry`
 * enforces (`entryWindowDeadline` / `checkEntryWindow`), so Today never shows
 * open what recording would reject. Pure over data already loaded in the
 * caller's single read.
 *
 * `pointsToday` is what the viewer's entries for the described day earned,
 * summed exactly and rounded once (day and `timesPerWeek` rows; a `weeklyTotal`
 * only pays when its week closes).
 */
export interface TodayRowsResult {
  readonly rows: readonly TodayRow[];
  readonly pointsToday: number;
}

export function todayRows(input: TodayRowsInput): TodayRowsResult {
  const { season, actualStart, today, refDay } = input;
  const earnedToday: Fraction[] = [];
  const habitNames = new Map<HabitId, string>(input.habits.map((h) => [h.id, h.name]));
  const engineSeason = {
    lengthWeeks: season.lengthWeeks,
    startWeekday: startWeekdayOf(actualStart),
  };
  const engineEntries = input.entries.map(toEngineEntry);
  const week = weekOf(refDay);

  const rows = input.commitments.map((commitment): TodayRow => {
    const habitName = habitNames.get(commitment.habitId);
    if (habitName === undefined) {
      throw new Error(`habit ${commitment.habitId} of commitment ${commitment.id} not found`);
    }
    const { schedule } = commitment.measure;
    const mine = input.entries.filter((entry) => entry.commitmentId === commitment.id);
    const progress = weekProgress({
      season: engineSeason,
      commitment: commitmentToEngine(commitment),
      week,
      entries: engineEntries.filter((entry) => entry.commitmentId === commitment.id),
      pauses: input.pauses.filter((pause) => pause.commitmentId === commitment.id),
      today: refDay,
    });
    const closed =
      checkEntryWindow({
        schedule,
        day: refDay,
        today,
        lengthWeeks: season.lengthWeeks,
        pauseGraceExtensionDays: PAUSE_GRACE_EXTENSION_DAYS,
      }) !== null;
    const state = stateOf(
      progress,
      refDay,
      closed,
      mine.some((entry) => entry.day === refDay),
    );
    const held = state === "paused" || state === "onHold";
    const engineCommitment = commitmentToEngine(commitment);
    const opportunities = activeOpportunities(season.lengthWeeks, (weekIndex) =>
      weekProgress({
        season: engineSeason,
        commitment: engineCommitment,
        week: weekIndex,
        entries: engineEntries.filter((entry) => entry.commitmentId === commitment.id),
        pauses: input.pauses.filter((pause) => pause.commitmentId === commitment.id),
        today: refDay,
      }),
    );
    // Only COUNTED opportunities show points, by the engine's own rule (R1): a day-bound one once it
    // has an entry. A week-bound one (timesPerWeek, weeklyTotal) counts from its week's close plus
    // grace, which is always AFTER the day a row describes (the row's day is inside its own week), so
    // it can never pay on the row: its points show up in the season card when the week is counted.
    const weekBound =
      schedule.period === "weeklyTotal" || schedule.frequency.kind === "timesPerWeek";
    const paysNow = !held && !weekBound;
    const ofRefDay = engineEntries.filter(
      (entry) => entry.commitmentId === commitment.id && entry.day === refDay,
    );
    // What the ENGINE assigned: the slot the day's entries filled (their own, or a make-up covering a
    // free one), at that slot's progress. An extra-day entry with no free slot filled none: it earns 0,
    // exactly as the season score has it. `pointsToday` is therefore "points earned by today's slots".
    const filled =
      progress.status === "scored"
        ? progress.slots.find((slot) => slot.filledFrom === refDay && slot.value !== null)
        : undefined;
    const earnedExact =
      paysNow && ofRefDay.length > 0
        ? filled === undefined
          ? fromInt(0)
          : opportunityPointsAt(engineCommitment, opportunities, filled.progress)
        : null;
    if (earnedExact !== null) earnedToday.push(earnedExact);
    const base: TodayRowBase = {
      commitmentId: commitment.id,
      habitName,
      privacy: commitment.privacy,
      measure: projectMeasure(commitment.measure),
      points: {
        ...perOpportunityViews(engineCommitment, opportunities),
        earned: earnedExact === null ? null : displayPoints(earnedExact),
        limitPercents: limitPercentsOf(commitment, engineCommitment),
      },
      opportunity: {
        state,
        graceUntil: held
          ? null
          : dateOfDay(
              actualStart,
              entryWindowDeadline(schedule, refDay, PAUSE_GRACE_EXTENSION_DAYS),
            ),
      },
      entries: mine
        .filter(
          (entry) =>
            checkEntryWindow({
              schedule,
              day: entry.day,
              today,
              lengthWeeks: season.lengthWeeks,
              pauseGraceExtensionDays: PAUSE_GRACE_EXTENSION_DAYS,
            }) === null,
        )
        .map((entry) => entryView(entry, actualStart)),
    };
    if (schedule.period === "perSession" && schedule.frequency.kind === "specificDays") {
      // The weekday of the day the row describes (refDay), not of the real today.
      const weekday = startWeekdayOf(dateOfDay(actualStart, refDay));
      return {
        kind: "day",
        ...base,
        scheduledToday: schedule.frequency.weekdays.includes(weekday),
      };
    }
    return {
      kind: "week",
      ...base,
      progress: progress.status === "scored" ? weekProgressView(progress) : null,
    };
  });
  return { rows, pointsToday: displayPoints(sumPoints(earnedToday)) };
}
