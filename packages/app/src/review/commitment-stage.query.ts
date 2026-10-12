import {
  type CommitmentId,
  commitmentWeeklySeries,
  deriveHabitStage,
  type HabitStage,
  periodFigures,
  type StageCounts,
} from "@pactjoy/engine";
import { findActiveMember } from "../circle/circle.ts";
import { loadEffectivePauses } from "../pause/effective-pauses.ts";
import type { Repositories } from "../ports/repositories.ts";
import { toScoreInput } from "../score/score-input.ts";
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
  /** `graduated` is never returned yet: no graduation path exists (REQ-H11). */
  readonly stage: HabitStage;
}

export type CommitmentStageError =
  | { readonly kind: "SeasonNotFound" }
  | { readonly kind: "NotAMember" }
  | { readonly kind: "CommitmentNotFound" };

/**
 * The maturity stage of one of the ASKING member's commitments (screen 17 badge), derived on every
 * read from Entries (through the effective pauses) and the member's own reviews; it is never
 * stored, so it can regress (REQ-H1). Owner only: another member's commitment, or an unknown
 * one, is `CommitmentNotFound` (fail closed, REQ-V1, SC-101). Before the season has a start day
 * nothing has ended yet, so the stage is `new`.
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

      const view = (stage: HabitStage) => ok({ commitmentId: input.commitmentId, stage });
      const actualStart = season.actualStart;
      if (actualStart === null) return view("new");
      const now = deps.clock.now();
      const day = toSeasonDay(deps.timeZone.localDateAt(now, season.timeZone), actualStart);
      if (day.kind === "beforeStart") return view("new");

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
          memberId: member.id,
          entries: await repos.entries.listBySeason(season.id),
          pauses,
          today: day.day,
        }),
      ).find((entry) => entry.commitmentId === input.commitmentId);
      if (series === undefined) throw new Error(`no series for commitment ${input.commitmentId}`);

      const finalWeeks: StageCounts[] = series.weeks
        .filter((week) => week.final)
        .map((week) => ({ kept: week.kept, counted: week.counted }));
      // The most recent ENDED period that had something counted (a fully paused one is skipped).
      let lastPeriod: StageCounts | null = null;
      for (const period of [
        ...reviewPeriods(season.lengthWeeks, season.reviewCadenceWeeks),
      ].reverse()) {
        if (period.firstWeek === null || period.lastWeek === null) continue;
        const figures = periodFigures(series.weeks, period.firstWeek - 1, period.lastWeek - 1);
        if (figures.final && figures.counted > 0) {
          lastPeriod = { kept: figures.kept, counted: figures.counted };
          break;
        }
      }
      // The latest completed review that answered this commitment.
      const reviews = await repos.reviews.listMine(season.id, member.id);
      let automaticity = null;
      for (const review of [...reviews].reverse()) {
        const response = review.responses.find((r) => r.commitmentId === input.commitmentId);
        if (review.status === "completed" && response !== undefined) {
          automaticity = scoreOfResponse(response);
          break;
        }
      }
      return view(deriveHabitStage({ finalWeeks, lastPeriod, automaticity, graduated: false }));
    },
  );
}
