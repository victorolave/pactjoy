import {
  type CommitmentId,
  commitmentWeeklySeries,
  displayPercent,
  displayPoints,
  type MemberId,
  type PeriodFigures,
  periodFigures,
  poolPeriodFigures,
  type SeasonDay,
} from "@pactjoy/engine";
import type { EntryRecord } from "../entry/entry.ts";
import type { Habit } from "../habit/habit.ts";
import type { MemberPauseRequest } from "../pause/pause-request.repository.ts";
import { toScoreInput } from "../score/score-input.ts";
import type { Season } from "../season/season.ts";
import type { LocalDate } from "../time/local-date.ts";

/** One commitment's figures for the weeks of a review period (screen 33). */
export interface CommitmentPeriodSummary {
  readonly commitmentId: CommitmentId;
  readonly habitName: string;
  readonly icon: string | null;
  readonly scheduleKind: "perSession" | "weeklyTotal";
  /** Counted opportunities that reached the minimum. */
  readonly kept: number;
  readonly counted: number;
  /** Percent; `null` when nothing was counted in the period (e.g. fully paused). */
  readonly consistencyPercent: number | null;
  readonly idealPercent: number | null;
  /** The commitment's contribution of the period to its season points (whole points). */
  readonly points: number;
}

export interface PeriodSummary {
  /** `false` while some week of the period is still inside its grace period: the figures can still change. */
  readonly final: boolean;
  /** Pooled over the counted opportunities of every commitment; points are summed. */
  readonly totals: {
    readonly consistencyPercent: number | null;
    readonly idealPercent: number | null;
    readonly points: number;
  };
  /** One per commitment of the member, in season order. */
  readonly commitments: readonly CommitmentPeriodSummary[];
}

export interface PeriodSummaryArgs {
  readonly season: Season;
  readonly actualStart: LocalDate;
  readonly memberId: MemberId;
  /** At least the habits of the member's commitments. */
  readonly habits: readonly Habit[];
  readonly entries: readonly EntryRecord[];
  /** The effective pauses at the read (the choke point's output). */
  readonly pauses: readonly MemberPauseRequest[];
  /** The engine's "today" (0-based season day). */
  readonly today: SeasonDay;
  /** The weeks of the period, 1-BASED and inclusive (the engine's weeks are 0-based; converted here once). */
  readonly firstWeek: number;
  readonly lastWeek: number;
}

function percentOrNull(figures: PeriodFigures["consistency"]): number | null {
  return figures === null ? null : displayPercent(figures);
}

/**
 * The live summary of one review period, computed from Entries through the engine on every call
 * (REQ-U2): nothing is stored. Per-commitment points are each rounded ONCE from their exact
 * value, as is the total, so displayed rows may not add up to the displayed total by a point.
 * Private commitments are included: this is the owner's own summary (REQ-V3).
 */
export function periodSummary(args: PeriodSummaryArgs): PeriodSummary {
  const { season, memberId } = args;
  const series = commitmentWeeklySeries(
    toScoreInput({
      season,
      actualStart: args.actualStart,
      memberId,
      entries: args.entries,
      pauses: args.pauses,
      today: args.today,
    }),
  );
  const habits = new Map(args.habits.map((habit) => [habit.id, habit]));
  const first = args.firstWeek - 1;
  const last = args.lastWeek - 1;
  const figures = series.map((entry) => periodFigures(entry.weeks, first, last));
  const rows = season.commitments
    .filter((commitment) => commitment.memberId === memberId)
    .map((commitment, index): CommitmentPeriodSummary => {
      const habit = habits.get(commitment.habitId);
      const own = figures[index];
      if (habit === undefined || own === undefined) {
        throw new Error(`review summary: no habit or figures for commitment ${commitment.id}`);
      }
      return {
        commitmentId: commitment.id,
        habitName: habit.name,
        icon: habit.icon,
        scheduleKind: commitment.measure.schedule.period,
        kept: own.kept,
        counted: own.counted,
        consistencyPercent: percentOrNull(own.consistency),
        idealPercent: percentOrNull(own.idealCompletion),
        points: displayPoints(own.points),
      };
    });
  const total = poolPeriodFigures(figures);
  return {
    final: total.final,
    totals: {
      consistencyPercent: percentOrNull(total.consistency),
      idealPercent: percentOrNull(total.idealCompletion),
      points: displayPoints(total.points),
    },
    commitments: rows,
  };
}
