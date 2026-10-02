/**
 * One commitment's one week as a read model ("Today"). It shares
 * `pause/pause-aware-week.ts`'s `planWeek` with the scoring path, so D4-D8
 * exist exactly once and this can never disagree with `scoreMember`.
 *
 * Statuses (corrected WP-R4): `paused` = the governing figure prorates to 0
 * (or every scheduled `specificDays` day is excluded), driven only by
 * approved pauses; `onHold` = the same with any pending day involved;
 * otherwise `scored` (a partial pause is `scored` with a prorated target).
 */
import type { Season, SeasonDay } from "../calendar/season-calendar.ts";
import { seasonDay } from "../calendar/season-calendar.ts";
import type { Commitment, Target } from "../commitment/commitment.ts";
import type { Entry } from "../entry/entry.ts";
import type { Fraction } from "../fraction/fraction.ts";
import { mean, sum } from "../fraction/fraction.ts";
import type { PauseRequest } from "../pause/pause.ts";
import { planWeek } from "../pause/pause-aware-week.ts";

const DAYS_PER_WEEK = 7;

export interface WeekProgressInput {
  readonly season: Season;
  readonly commitment: Commitment;
  /** 0-based season week, inside `[0, season.lengthWeeks)`. */
  readonly week: number;
  /** Unscoped is fine: other commitments' (and other weeks') entries are ignored. */
  readonly entries: readonly Entry[];
  /** Unscoped is fine: other commitments' requests are ignored. */
  readonly pauses: readonly PauseRequest[];
  /** The snapshot day for pause resolution (same as `ScoreInput.today`). */
  readonly today: SeasonDay;
}

/**
 * One active scheduled day of a `specificDays` week. `value` is what the
 * scoring path counted for this slot, which may come from a make-up entry
 * logged on a different day (the `specificDays` make-up rule): `value !== null`
 * does NOT mean something was logged on `day`.
 */
export interface WeekSlot {
  readonly day: SeasonDay;
  readonly value: Fraction | null;
  readonly progress: Fraction;
  readonly consistent: boolean;
}

/** The week's excluded days, ascending. */
export interface WeekExclusions {
  readonly paused: readonly SeasonDay[];
  readonly onHold: readonly SeasonDay[];
}

export type WeekProgress =
  | { readonly status: "paused" | "onHold"; readonly excluded: WeekExclusions }
  | {
      readonly status: "scored";
      /** Prorated for `weeklyTotal`; the commitment's own target otherwise. */
      readonly target: Target;
      /** Prorated N, active scheduled days, or 1 for `weeklyTotal`. */
      readonly sessionsTarget: number;
      /** Opportunities that reached the minimum (best-N already caps it). */
      readonly sessionsDone: number;
      /** Mean progress of the week's opportunities, 0..1. */
      readonly progress: Fraction;
      /** The on-time sum (`weeklyTotal`) or the sum of counted values; `null` when none. */
      readonly value: Fraction | null;
      /** `specificDays` only; empty otherwise. */
      readonly slots: readonly WeekSlot[];
      readonly excluded: WeekExclusions;
    };

/** @throws {RangeError} if `week` is outside `[0, season.lengthWeeks)`. */
export function weekProgress(input: WeekProgressInput): WeekProgress {
  const { season, commitment, week, today } = input;
  if (!Number.isInteger(week) || week < 0 || week >= season.lengthWeeks) {
    throw new RangeError(`weekProgress: week ${week} is outside [0, ${season.lengthWeeks})`);
  }
  const start = week * DAYS_PER_WEEK;
  const entries = input.entries.filter(
    (e) => e.commitmentId === commitment.id && e.day >= start && e.day < start + DAYS_PER_WEEK,
  );
  const pauses = input.pauses.filter((p) => p.commitmentId === commitment.id);

  const plan = planWeek(commitment, week, pauses, entries, today, { season });
  const weekDays = Array.from({ length: DAYS_PER_WEEK }, (_, i) => seasonDay(start + i));
  const excluded = {
    paused: weekDays.filter((day) => plan.paused.has(day)),
    onHold: weekDays.filter((day) => plan.onHold.has(day)),
  };
  if (plan.result.status !== "scored") return { status: plan.result.status, excluded };

  const { sessions } = plan.result;
  const values = sessions.flatMap((s) => (s.value === null ? [] : [s.value]));
  const slots = plan.activeScheduledDays.map((day, i) => {
    const session = sessions[i];
    if (session === undefined) throw new Error("weekProgress: slot without a session");
    return {
      day,
      value: session.value,
      progress: session.progress,
      consistent: session.consistent,
    };
  });
  return {
    status: "scored",
    target: plan.target,
    sessionsTarget: sessions.length,
    sessionsDone: sessions.filter((s) => s.consistent).length,
    progress: mean(sessions.map((s) => s.progress)),
    value: values.length === 0 ? null : sum(values),
    slots,
    excluded,
  };
}
