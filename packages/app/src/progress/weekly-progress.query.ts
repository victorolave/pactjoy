import type { MemberId, SeasonDay } from "@pactjoy/engine";
import {
  displayPercent,
  displayPoints,
  graceDeadline,
  seasonDay,
  type WeekFigures,
  weeklySeries,
} from "@pactjoy/engine";
import type { ScoreData } from "../score/score-context.ts";
import { toScoreInput } from "../score/score-input.ts";
import type { Season } from "../season/season.ts";
import type { LocalDate } from "../time/local-date.ts";
import { localDateOfSeasonDay } from "../time/season-calendar.ts";
import { DAYS_PER_WEEK, type SeasonPhase, weekOf } from "../today/season-phase.ts";
import type { SeasonWeek, StandingsEntry, WeekFacts } from "./progress-view.ts";

export interface SeasonWeeksInput {
  readonly season: Season;
  readonly actualStart: LocalDate;
  readonly today: SeasonDay;
  readonly phase: SeasonPhase & { readonly phase: "active" | "ended" };
  readonly standingsRows: readonly StandingsEntry[];
  readonly data: ScoreData;
}

/**
 * Builds the season weeks array with live weekly series from the engine.
 * One snapshot governs all weeks and members; display rounding happens once.
 * Note: facts.counted=false for the current week means the week block has not closed.
 */
export function seasonWeeks({
  season,
  actualStart,
  today,
  phase,
  standingsRows,
  data,
}: SeasonWeeksInput): readonly SeasonWeek[] {
  const seriesByMember = new Map<MemberId, readonly WeekFigures[]>();
  for (const row of standingsRows) {
    const scoreInput = toScoreInput({
      season,
      actualStart,
      today,
      memberId: row.memberId,
      entries: data.entries,
      pauses: data.pauses,
    });
    seriesByMember.set(row.memberId, weeklySeries(scoreInput));
  }

  const currentWeekIndex = weekOf(phase.scoringDay) - 1;
  const isEnded = phase.phase === "ended";

  return Array.from({ length: season.lengthWeeks }, (_, weekIndex) => {
    const firstDay = seasonDay(weekIndex * DAYS_PER_WEEK);
    const lastDay = seasonDay(weekIndex * DAYS_PER_WEEK + DAYS_PER_WEEK - 1);
    const deadline = graceDeadline(lastDay);

    const timing = isEnded
      ? "past"
      : weekIndex < currentWeekIndex
        ? "past"
        : weekIndex === currentWeekIndex
          ? "current"
          : "future";

    const isFuture = timing === "future";
    const weekClosed = today > lastDay;
    const weekGraceOver = today > deadline;

    const facts: WeekFacts = {
      counted: isFuture ? false : weekClosed,
      editable: !isFuture && !weekGraceOver,
      final: isFuture ? false : weekGraceOver,
    };

    const members = standingsRows.map((row) => {
      const fig = seriesByMember.get(row.memberId)?.[weekIndex];
      return {
        memberId: row.memberId,
        points: isFuture || !fig ? null : displayPoints(fig.points),
        consistency:
          isFuture || !fig || fig.consistency === null ? null : displayPercent(fig.consistency),
        idealCompletion:
          isFuture || !fig || fig.idealCompletion === null
            ? null
            : displayPercent(fig.idealCompletion),
      };
    });

    return {
      weekIndex,
      start: localDateOfSeasonDay(firstDay, actualStart),
      end: localDateOfSeasonDay(lastDay, actualStart),
      timing,
      facts,
      members,
    };
  });
}
