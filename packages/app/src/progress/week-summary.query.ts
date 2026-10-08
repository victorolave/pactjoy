import type { Fraction, MemberId } from "@pactjoy/engine";
import {
  displayPercent,
  displayPoints,
  graceDeadline,
  historyProvenance,
  opportunityCounts,
  opportunityPointsAt,
  seasonDay,
  sumPoints,
  weeklySeries,
  weekProgress,
} from "@pactjoy/engine";
import { commitmentToEngine } from "../commitment/to-engine.ts";
import { projectMeasure, projectTarget } from "../score/commitment-projection.ts";
import {
  loadScoreContext,
  type ScoreContextError,
  type ScoreData,
  type ScoreQueryDeps,
  type StartedScoreContext,
} from "../score/score-context.ts";
import { toScoreInput } from "../score/score-input.ts";
import { standingsView } from "../score/standings.query.ts";
import type { Actor } from "../shared/actor.ts";
import { toDecimalString } from "../shared/decimal.ts";
import type { SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { localDateOfSeasonDay } from "../time/season-calendar.ts";
import { DAYS_PER_WEEK, seasonPhase, weekOf } from "../today/season-phase.ts";
import type { TodayWeekProgress } from "../today/today-rows.ts";
import type { WeekFacts, WeekRange, WeekSummaryView } from "./progress-view.ts";

export type WeekSummaryDeps = ScoreQueryDeps;
export type WeekSummaryError = ScoreContextError;
export interface WeekSummaryInput {
  readonly seasonId: SeasonId;
  readonly weekIndex: number;
}

/**
 * Public query for the viewer's own week summary (screens 25a–c).
 * Recomputed live in a single uow.read; never persisted as a snapshot.
 */
export async function weekSummary(
  deps: WeekSummaryDeps,
  actor: Actor,
  input: WeekSummaryInput,
): Promise<Result<WeekSummaryView, WeekSummaryError>> {
  return deps.uow.read(async (repos) => {
    const context = await loadScoreContext(deps, repos, actor, input.seasonId);
    if (!context.ok) return context;

    const { season, viewer, start } = context.value;
    if (!start) return err({ kind: "SeasonNotFound" });

    const today = localDateOfSeasonDay(start.today, start.actualStart);
    const phase = seasonPhase(season, today);
    if (phase.phase === "pactOpen" || phase.phase === "notStarted") {
      return err({ kind: "SeasonNotFound" });
    }

    const { weekIndex } = input;
    if (!Number.isInteger(weekIndex) || weekIndex < 0 || weekIndex >= season.lengthWeeks) {
      return err({ kind: "SeasonNotFound" });
    }

    const data: ScoreData = {
      entries: await repos.entries.listBySeason(season.id),
      pauses: await repos.pauses.listBySeason(season.id),
    };

    const habits = await repos.habits.getMany(
      season.commitments.filter((c) => c.memberId === viewer.id).map((c) => c.habitId),
    );

    const firstDay = seasonDay(weekIndex * DAYS_PER_WEEK);
    const lastDay = seasonDay(weekIndex * DAYS_PER_WEEK + DAYS_PER_WEEK - 1);
    const deadline = graceDeadline(lastDay);

    const currentWeekIndex = weekOf(phase.scoringDay) - 1;
    const isEnded = phase.phase === "ended";

    const timing = isEnded
      ? "past"
      : weekIndex < currentWeekIndex
        ? "past"
        : weekIndex === currentWeekIndex
          ? "current"
          : "future";

    const isFuture = timing === "future";
    const weekClosed = start.today > lastDay;
    const weekGraceOver = start.today > deadline;

    const facts: WeekFacts = {
      counted: isFuture ? false : weekClosed,
      editable: !isFuture && !weekGraceOver,
      final: isFuture ? false : weekGraceOver,
    };

    const weekRange: WeekRange = {
      weekIndex,
      start: localDateOfSeasonDay(firstDay, start.actualStart),
      end: localDateOfSeasonDay(lastDay, start.actualStart),
      timing,
      facts,
    };

    const viewerScoreInput = toScoreInput({
      season,
      actualStart: start.actualStart,
      today: start.today,
      memberId: viewer.id,
      entries: data.entries,
      pauses: data.pauses,
    });
    const viewerSeries = weeklySeries(viewerScoreInput);
    const fig = viewerSeries[weekIndex];

    const points = isFuture || !fig ? 0 : displayPoints(fig.points);
    const consistency =
      isFuture || !fig || fig.consistency === null ? null : displayPercent(fig.consistency);
    const idealCompletion =
      isFuture || !fig || fig.idealCompletion === null ? null : displayPercent(fig.idealCompletion);

    let headline: "best" | "difficult" | null = null;
    if (consistency !== null && consistency < 50) {
      headline = "difficult";
    } else if (weekIndex > 0) {
      const priorCountedPoints: number[] = [];
      for (let w = 0; w < weekIndex; w++) {
        const wLastDay = seasonDay(w * DAYS_PER_WEEK + DAYS_PER_WEEK - 1);
        if (start.today > wLastDay) {
          const wFig = viewerSeries[w];
          if (wFig) priorCountedPoints.push(displayPoints(wFig.points));
        }
      }
      if (priorCountedPoints.length > 0 && priorCountedPoints.every((p) => points > p)) {
        headline = "best";
      }
    }

    const remaining = season.lengthWeeks - (weekIndex + 1);
    const weeksLeft = remaining > 0 ? remaining : 0;

    const viewerCommitments = season.commitments.filter((c) => c.memberId === viewer.id);
    const commitments = viewerCommitments.map((c) => {
      const habit = habits.find((candidate) => candidate.id === c.habitId);
      const engineCommitment = commitmentToEngine(c);
      const weekProg = weekProgress({
        ...viewerScoreInput,
        commitment: engineCommitment,
        week: weekIndex,
      });

      if (weekProg.status !== "scored") {
        return {
          commitmentId: c.id,
          habit: { name: habit?.name ?? "", icon: habit?.icon ?? null },
          measure: projectMeasure(c.measure),
          points: null,
          progress: null,
        };
      }

      const counts = opportunityCounts(engineCommitment, viewerScoreInput);
      const historyWeeks = historyProvenance(engineCommitment, viewerScoreInput);
      const weekHistory = historyWeeks.find((w) => w.week === weekIndex);
      let commitmentPoints: number | null = null;

      if (weekHistory && weekHistory.status === "scored" && counts.total > 0) {
        const earnedFractions: Fraction[] = [];
        for (const cell of weekHistory.cells) {
          if (cell.counted && cell.progress !== null) {
            earnedFractions.push(
              opportunityPointsAt(engineCommitment, counts.total, cell.progress),
            );
          }
        }
        commitmentPoints = isFuture ? null : displayPoints(sumPoints(earnedFractions));
      }

      const progress: TodayWeekProgress = {
        value: weekProg.value === null ? null : toDecimalString(weekProg.value),
        target: projectTarget(weekProg.target),
        sessionsDone: weekProg.sessionsDone,
        sessionsTarget: weekProg.sessionsTarget,
        percent: displayPercent(weekProg.progress),
      };

      return {
        commitmentId: c.id,
        habit: { name: habit?.name ?? "", icon: habit?.icon ?? null },
        measure: projectMeasure(c.measure),
        points: commitmentPoints,
        progress,
      };
    });

    const startedContext: StartedScoreContext = { ...context.value, start };
    const standings = standingsView(startedContext, data);
    let circle:
      | readonly {
          readonly memberId: MemberId;
          readonly displayName: string;
          readonly points: number | null;
        }[]
      | null = null;

    if (standings.eligibleParticipantCount === 2) {
      circle = standings.rows.map((row) => {
        const memberScoreInput = toScoreInput({
          season,
          actualStart: start.actualStart,
          today: start.today,
          memberId: row.memberId,
          entries: data.entries,
          pauses: data.pauses,
        });
        const memberSeries = weeklySeries(memberScoreInput);
        const mFig = memberSeries[weekIndex];
        return {
          memberId: row.memberId,
          displayName: row.displayName,
          points: isFuture || !mFig ? null : displayPoints(mFig.points),
        };
      });
    }

    return ok({
      ...weekRange,
      points,
      consistency,
      idealCompletion,
      viewerId: viewer.id,
      season: {
        id: season.id,
        timeZone: season.timeZone,
        lengthWeeks: season.lengthWeeks,
        actualStart: start.actualStart,
        lastDay: localDateOfSeasonDay(phase.lastDay, start.actualStart),
      },
      headline,
      weeksLeft,
      commitments,
      circle,
    });
  });
}
