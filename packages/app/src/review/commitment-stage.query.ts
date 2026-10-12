import {
  type CommitmentId,
  commitmentWeeklySeries,
  deriveHabitStage,
  type HabitStage,
  type MemberId,
  periodFigures,
  type StageCounts,
} from "@pactjoy/engine";
import { type Circle, findActiveMember } from "../circle/circle.ts";
import { loadEffectivePauses } from "../pause/effective-pauses.ts";
import type { Repositories } from "../ports/repositories.ts";
import { toScoreInput } from "../score/score-input.ts";
import type { Season } from "../season/season.ts";
import type { Actor } from "../shared/actor.ts";
import type { SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { toSeasonDay } from "../time/season-calendar.ts";
import { scoreOfResponse } from "./improvements.ts";
import type { ReviewClockDeps } from "./review-context.ts";
import { reviewPeriods } from "./review-schedule.ts";

export interface CommitmentStageDeps extends ReviewClockDeps {
  readonly uow: { read<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> };
}

export interface CommitmentStageInput {
  readonly seasonId: SeasonId;
  readonly commitmentId: CommitmentId;
}

/** The owner-only read model: the commitment and its derived stage, nothing else. */
export interface CommitmentStageView {
  readonly commitmentId: CommitmentId;
  /** `graduated` once the owner graduated the habit (REQ-H3'); every other stage is derived. */
  readonly stage: HabitStage;
}

export type CommitmentStageError =
  | { readonly kind: "SeasonNotFound" }
  | { readonly kind: "NotAMember" }
  | { readonly kind: "CommitmentNotFound" };

export interface CommitmentStagesInput {
  readonly season: Season;
  readonly circle: Circle;
  /** The member whose commitments are staged; the caller has already proven who they are. */
  readonly memberId: MemberId;
}

/**
 * The derived maturity stage of EVERY commitment `memberId` holds in `season`, keyed by commitment
 * id (screen 17 badge, results screen 36). Stages are derived on every read from Entries (through
 * the effective pauses), the member's own reviews and the habit's `graduatedAt`; nothing is stored,
 * so a stage can regress (REQ-H1) but a graduation never does. Owner-only by construction: the
 * caller passes the asking member's own id. Before the season has a start day nothing has ended
 * yet, so a habit that is not graduated is `new`.
 */
export async function commitmentStages(
  deps: ReviewClockDeps,
  repos: Repositories,
  input: CommitmentStagesInput,
): Promise<ReadonlyMap<CommitmentId, HabitStage>> {
  const { season, circle, memberId } = input;
  const own = season.commitments.filter((commitment) => commitment.memberId === memberId);
  const stages = new Map<CommitmentId, HabitStage>();
  if (own.length === 0) return stages;

  const habits = await repos.habits.getMany(own.map((commitment) => commitment.habitId));
  const graduatedHabits = new Set(
    habits.filter((habit) => habit.graduatedAt !== null).map((habit) => habit.id),
  );
  const isGraduated = (commitment: (typeof own)[number]): boolean =>
    graduatedHabits.has(commitment.habitId);

  const now = deps.clock.now();
  const actualStart = season.actualStart;
  const day =
    actualStart === null
      ? null
      : toSeasonDay(deps.timeZone.localDateAt(now, season.timeZone), actualStart);
  if (actualStart === null || day === null || day.kind === "beforeStart") {
    for (const commitment of own) {
      stages.set(commitment.id, isGraduated(commitment) ? "graduated" : "new");
    }
    return stages;
  }

  const pauses = await loadEffectivePauses(repos, {
    season,
    circle,
    now,
    timeZone: deps.timeZone,
  });
  const series = commitmentWeeklySeries(
    toScoreInput({
      season,
      actualStart,
      memberId,
      entries: await repos.entries.listBySeason(season.id),
      pauses,
      today: day.day,
    }),
  );
  const reviews = await repos.reviews.listMine(season.id, memberId);

  for (const commitment of own) {
    const weekly = series.find((entry) => entry.commitmentId === commitment.id);
    if (weekly === undefined) continue;

    const finalWeeks: StageCounts[] = weekly.weeks
      .filter((week) => week.final)
      .map((week) => ({ kept: week.kept, counted: week.counted }));
    // The most recent ENDED period that had something counted (a fully paused one is skipped).
    let lastPeriod: StageCounts | null = null;
    for (const period of [
      ...reviewPeriods(season.lengthWeeks, season.reviewCadenceWeeks),
    ].reverse()) {
      if (period.firstWeek === null || period.lastWeek === null) continue;
      const figures = periodFigures(weekly.weeks, period.firstWeek - 1, period.lastWeek - 1);
      if (figures.final && figures.counted > 0) {
        lastPeriod = { kept: figures.kept, counted: figures.counted };
        break;
      }
    }
    // The latest completed review that answered this commitment.
    let automaticity = null;
    for (const review of [...reviews].reverse()) {
      const response = review.responses.find((r) => r.commitmentId === commitment.id);
      if (review.status === "completed" && response !== undefined) {
        automaticity = scoreOfResponse(response);
        break;
      }
    }
    stages.set(
      commitment.id,
      deriveHabitStage({
        finalWeeks,
        lastPeriod,
        automaticity,
        graduated: isGraduated(commitment),
      }),
    );
  }
  return stages;
}

/**
 * The maturity stage of one of the ASKING member's commitments (screen 17 badge), derived on every
 * read (see {@link commitmentStages}). Owner only: another member's commitment, or an unknown
 * one, is `CommitmentNotFound` (fail closed, REQ-V1, SC-101).
 */
export async function commitmentStage(
  deps: CommitmentStageDeps,
  actor: Actor,
  input: CommitmentStageInput,
): Promise<Result<CommitmentStageView, CommitmentStageError>> {
  return deps.uow.read(
    async (repos): Promise<Result<CommitmentStageView, CommitmentStageError>> => {
      const season = await repos.seasons.get(input.seasonId);
      if (!season) return err({ kind: "SeasonNotFound" });
      const circle = await repos.circles.get(season.circleId);
      const member = circle ? findActiveMember(circle, actor.userId) : undefined;
      if (!circle || !member) return err({ kind: "NotAMember" });
      const owned = season.commitments.some(
        (commitment) => commitment.id === input.commitmentId && commitment.memberId === member.id,
      );
      if (!owned) return err({ kind: "CommitmentNotFound" });

      const stages = await commitmentStages(deps, repos, {
        season,
        circle,
        memberId: member.id,
      });
      const stage = stages.get(input.commitmentId);
      if (stage === undefined) throw new Error(`no series for commitment ${input.commitmentId}`);
      return ok({ commitmentId: input.commitmentId, stage });
    },
  );
}
