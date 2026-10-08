import { type MemberId, opportunityCounts, weekProgress } from "@pactjoy/engine";
import { type MemberScoreError, memberScoreView } from "../score/member-score.query.ts";
import { isParticipant, loadScoreContext, type ScoreQueryDeps } from "../score/score-context.ts";
import { toScoreInput } from "../score/score-input.ts";
import type { Actor } from "../shared/actor.ts";
import type { SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { localDateOfSeasonDay } from "../time/season-calendar.ts";
import { DAYS_PER_WEEK, seasonPhase, weekOf } from "../today/season-phase.ts";
import type {
  CommitmentProgressRow,
  HiddenCommitmentRow,
  MemberProgressView,
} from "./progress-view.ts";

export type MemberProgressDeps = ScoreQueryDeps;
export type MemberProgressError = MemberScoreError;
export interface MemberProgressInput {
  readonly seasonId: SeasonId;
  readonly memberId: MemberId;
}

/** One authorized snapshot. Peer totals include private commitments, never their metadata. */
export async function memberProgress(
  deps: MemberProgressDeps,
  actor: Actor,
  input: MemberProgressInput,
): Promise<Result<MemberProgressView, MemberProgressError>> {
  return deps.uow.read(async (repos) => {
    const context = await loadScoreContext(deps, repos, actor, input.seasonId);
    if (!context.ok) return context;
    const { season, circle, viewer, start } = context.value;
    const target = circle.members.find(
      (m) => m.id === input.memberId && isParticipant(season, m.id),
    );
    if (!target) return err({ kind: "MemberNotFound" });
    if (!start) return ok({ state: "notStarted", seasonId: season.id });
    const today = localDateOfSeasonDay(start.today, start.actualStart);
    const phase = seasonPhase(season, today);
    if (phase.phase === "pactOpen" || phase.phase === "notStarted") {
      return ok({ state: "notStarted", seasonId: season.id });
    }
    const data = {
      entries: await repos.entries.listBySeason(season.id),
      pauses: await repos.pauses.listBySeason(season.id),
    };
    const score = memberScoreView({ ...context.value, start }, data, target);
    if (score.kind !== "scored") throw new Error("expected started member score");
    const detail = score.commitments.filter((row) => row.kind === "detail");
    const habits = detail.length
      ? await repos.habits.getMany(detail.map((row) => row.habitId))
      : [];
    const scoreInput = toScoreInput({
      season,
      actualStart: start.actualStart,
      memberId: target.id,
      today: start.today,
      entries: data.entries,
      pauses: data.pauses,
    });
    const commitments = score.commitments.map(
      (row): CommitmentProgressRow | HiddenCommitmentRow => {
        if (row.kind === "hidden") return row;
        const { habitId, ...visible } = row;
        const habit = habits.find((h) => h.id === habitId);
        const commitment = scoreInput.commitments.find((c) => c.id === row.commitmentId);
        if (!habit || !commitment)
          throw new Error(`missing detail for commitment ${row.commitmentId}`);
        const { kept, counted } = opportunityCounts(commitment, scoreInput);
        const week = weekProgress({
          ...scoreInput,
          commitment,
          week: weekOf(phase.scoringDay) - 1,
        });
        const pause =
          week.status !== "scored"
            ? week.status
            : week.excluded.paused.includes(phase.scoringDay)
              ? "paused"
              : week.excluded.onHold.includes(phase.scoringDay)
                ? "onHold"
                : "none";
        return {
          ...visible,
          habit: { name: habit.name, icon: habit.icon },
          opportunities: { kept, counted },
          pause,
        };
      },
    );
    const base = {
      state: phase.phase,
      viewerId: viewer.id,
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
      member: { memberId: target.id, displayName: target.displayName },
      points: score.points,
      consistency: score.consistency,
      idealCompletion: score.idealCompletion,
    };
    if (score.scope === "own") {
      if (!commitments.every((row) => row.kind === "detail"))
        throw new Error("hidden own commitment");
      return ok({ ...base, scope: "own", commitments });
    }
    return ok({ ...base, scope: "others", commitments });
  });
}
