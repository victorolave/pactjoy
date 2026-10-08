import { opportunityCounts, weekProgress } from "@pactjoy/engine";
import type { Habit } from "../habit/habit.ts";
import { memberScoreView } from "../score/member-score.query.ts";
import type { ScoreContext, ScoreData } from "../score/score-context.ts";
import { toScoreInput } from "../score/score-input.ts";
import { standingsView } from "../score/standings.query.ts";
import { localDateOfSeasonDay } from "../time/season-calendar.ts";
import { DAYS_PER_WEEK, seasonPhase, weekOf } from "../today/season-phase.ts";
import type {
  CommitmentProgressRow,
  NotStartedProgress,
  SeasonProgressView,
} from "./progress-view.ts";

/** Internal composition seam, NOT a complete public progress response (A2 adds weeks). */
export type SeasonProgressCore =
  | NotStartedProgress
  | Omit<Extract<SeasonProgressView, { state: "active" | "ended" }>, "weeks">;

/**
 * Pure core for an already-authorized read snapshot. The caller supplies the
 * single captured season-local day, entries, pause facts and only its own
 * habits. No clock, repository or nested query is consulted here.
 */
export function seasonProgressCore(
  context: ScoreContext,
  data: ScoreData,
  habits: readonly Habit[],
): SeasonProgressCore {
  const { season, viewer, start } = context;
  if (start === null) return { state: "notStarted", seasonId: season.id };
  const today = localDateOfSeasonDay(start.today, start.actualStart);
  const phase = seasonPhase(season, today);
  if (phase.phase === "pactOpen" || phase.phase === "notStarted") {
    return { state: "notStarted", seasonId: season.id };
  }
  const started = { ...context, start };
  const own = memberScoreView(started, data, viewer);
  if (own.kind !== "scored" || own.scope !== "own") throw new Error("expected own score");
  const scoreInput = toScoreInput({
    season,
    actualStart: start.actualStart,
    today: start.today,
    memberId: viewer.id,
    entries: data.entries,
    pauses: data.pauses,
  });
  const commitments = own.commitments.map((row): CommitmentProgressRow => {
    if (row.kind !== "detail") throw new Error("own commitment must have detail");
    const { habitId, ...detail } = row;
    const habit = habits.find((candidate) => candidate.id === habitId);
    if (!habit) throw new Error(`no habit for own commitment ${row.commitmentId}`);
    const commitment = scoreInput.commitments.find(
      (candidate) => candidate.id === row.commitmentId,
    );
    if (!commitment) throw new Error(`no engine commitment ${row.commitmentId}`);
    const { kept, counted } = opportunityCounts(commitment, scoreInput);
    const week = weekProgress({
      ...scoreInput,
      commitment,
      week: weekOf(phase.scoringDay) - 1,
    });
    // Same precedence as Today: whole-week exclusion, then the reference day's facts.
    const pause =
      week.status !== "scored"
        ? week.status
        : week.excluded.paused.includes(phase.scoringDay)
          ? "paused"
          : week.excluded.onHold.includes(phase.scoringDay)
            ? "onHold"
            : "none";
    return {
      ...detail,
      habit: { name: habit.name, icon: habit.icon },
      opportunities: { kept, counted },
      pause,
    };
  });
  const standings = standingsView(started, data);
  const allZero = standings.rows.every((row) => row.points === 0);
  const rows = [...standings.rows]
    .sort(
      (a, b) =>
        b.points - a.points ||
        a.displayName.localeCompare(b.displayName, "es") ||
        a.memberId.localeCompare(b.memberId),
    )
    .map((row) => ({
      ...row,
      rank: allZero ? null : row.rank,
      isViewer: row.memberId === viewer.id,
    }));
  return {
    state: phase.phase,
    viewerId: viewer.id,
    circle: { id: context.circle.id, name: context.circle.name },
    season: {
      id: season.id,
      timeZone: season.timeZone,
      lengthWeeks: season.lengthWeeks,
      actualStart: start.actualStart,
      lastDay: localDateOfSeasonDay(phase.lastDay, start.actualStart),
    },
    calendar: {
      today,
      weekIndex: weekOf(phase.scoringDay) - 1,
      dayOfWeek: (phase.scoringDay % DAYS_PER_WEEK) + 1,
      daysLeft: phase.lastDay - phase.scoringDay,
    },
    own: {
      points: own.points,
      consistency: own.consistency,
      idealCompletion: own.idealCompletion,
      commitments,
    },
    standings: { memberCount: standings.eligibleParticipantCount, rows },
  };
}
