import type { CommitmentId, HabitStage } from "@pactjoy/engine";
import { findActiveMember } from "../../circle/circle.ts";
import type { Repositories } from "../../ports/repositories.ts";
import { automaticityJourney, closingReviewDone } from "../../review/automaticity-journey.ts";
import { commitmentStages } from "../../review/commitment-stage.query.ts";
import { memberScoreView } from "../../score/member-score.query.ts";
import {
  loadPausesFor,
  type ScoreData,
  type ScoreQueryDeps,
  scoreContextOf,
} from "../../score/score-context.ts";
import { standingsView } from "../../score/standings.query.ts";
import type { Actor } from "../../shared/actor.ts";
import type { HabitId, SeasonId } from "../../shared/ids.ts";
import { err, ok, type Result } from "../../shared/result.ts";
import type { Instant } from "../../time/instant.ts";
import type { LocalDate } from "../../time/local-date.ts";
import type { SeasonLengthWeeks } from "../season.ts";
import { closeDatesOf, seasonCloseCalendar, seasonCloseDay } from "./season-calendar.ts";
import type { CommitmentClosureDecision } from "./season-closure.ts";
import { lastDayOf, type SeasonStandingView, standingOf } from "./season-figures.ts";

export type SeasonResultsDeps = ScoreQueryDeps;

export interface SeasonResultsInput {
  readonly seasonId: SeasonId;
}

export interface SeasonResultsCommitment {
  readonly commitmentId: CommitmentId;
  readonly habitId: HabitId;
  readonly habitName: string;
  readonly icon: string | null;
  readonly points: number;
  readonly consistencyPercent: number | null;
  readonly idealPercent: number | null;
  /** The automaticity start and the closing review's score ("de 3,0 a 4,5"); owner-only. */
  readonly automaticity: { readonly from: string | null; readonly to: string | null };
  /** The derived maturity stage, `graduated` once the owner graduated the habit; owner-only. */
  readonly stage: HabitStage;
}

/** Screen 36 "Resultados": the viewer's final figures for an ended season. Owner-only throughout. */
export interface SeasonResultsView {
  readonly seasonId: SeasonId;
  readonly status: "active" | "closed";
  readonly lengthWeeks: SeasonLengthWeeks;
  readonly actualStart: LocalDate;
  readonly lastDay: LocalDate;
  readonly totals: {
    readonly points: number;
    readonly consistencyPercent: number | null;
    readonly idealPercent: number | null;
  };
  readonly standings: SeasonStandingView;
  /** The viewer's own commitments, in season order. */
  readonly commitments: readonly SeasonResultsCommitment[];
  /** `false` until the closing review is completed; the closure needs it, the figures do not. */
  readonly closingReviewDone: boolean;
  /** The viewer's own closure, or `null` while they have not closed. */
  readonly closure: {
    readonly decidedAt: Instant;
    readonly decisions: readonly CommitmentClosureDecision[];
  } | null;
}

export type SeasonResultsError =
  | { readonly kind: "SeasonNotFound" }
  | { readonly kind: "NotAMember" }
  | { readonly kind: "SeasonNotActive" }
  | { readonly kind: "SeasonResultsNotYet"; readonly availableOn: LocalDate }
  | { readonly kind: "NothingToClose" };

/**
 * The viewer's final figures of an ended season, recomputed from Entries on every call (nothing is
 * stored). Readable from the results day on, before and after the season is finalized; before it
 * the date is named. Only an ACTIVE member with commitments in the season reads, and only their
 * own: no member id comes from the request, so a peer's automaticity, stage or closure cannot be
 * addressed. The closing review is not a precondition of reading (the flag says whether it is
 * done); it is one of closing. Writes nothing.
 */
export async function seasonResults(
  deps: SeasonResultsDeps,
  actor: Actor,
  input: SeasonResultsInput,
): Promise<Result<SeasonResultsView, SeasonResultsError>> {
  return deps.uow.read(
    async (repos: Repositories): Promise<Result<SeasonResultsView, SeasonResultsError>> => {
      const season = await repos.seasons.get(input.seasonId);
      if (!season) return err({ kind: "SeasonNotFound" });
      const circle = await repos.circles.get(season.circleId);
      const member = circle ? findActiveMember(circle, actor.userId) : undefined;
      if (!circle || !member) return err({ kind: "NotAMember" });
      const start = season.actualStart;
      const dates = closeDatesOf(season);
      const lastDay = lastDayOf(season);
      if (
        (season.status !== "active" && season.status !== "closed") ||
        start === null ||
        dates === null ||
        lastDay === null
      ) {
        return err({ kind: "SeasonNotActive" });
      }
      const mine = season.commitments.filter((commitment) => commitment.memberId === member.id);
      if (mine.length === 0) return err({ kind: "NothingToClose" });

      const now = deps.clock.now();
      const day = seasonCloseDay(season, now, deps.timeZone);
      const { resultsFrom } = seasonCloseCalendar(season.lengthWeeks);
      if (season.status === "active" && (day.kind === "beforeStart" || day.day < resultsFrom)) {
        return err({ kind: "SeasonResultsNotYet", availableOn: dates.resultsOn });
      }

      const context = scoreContextOf(deps, season, circle, actor);
      if (!context.ok || context.value.start === null) {
        throw new Error(`member ${member.id} cannot read season ${season.id}`);
      }
      const started = { ...context.value, start: context.value.start };
      const data: ScoreData = {
        entries: await repos.entries.listBySeason(season.id),
        pauses: await loadPausesFor(deps, repos, context.value),
      };
      const own = memberScoreView(started, data, started.viewer);
      if (own.kind !== "scored" || own.scope !== "own") throw new Error("expected own score");
      const ranked = standingsView(started, data);

      const habits = new Map(
        (await repos.habits.getMany(mine.map((commitment) => commitment.habitId))).map((habit) => [
          habit.id,
          habit,
        ]),
      );
      const stages = await commitmentStages(deps, repos, {
        season,
        circle,
        memberId: member.id,
      });
      const journey = await automaticityJourney(repos, season, member.id);
      const closure = await repos.seasonClosures.getMine(season.id, member.id);

      const commitments = own.commitments.map((row): SeasonResultsCommitment => {
        if (row.kind !== "detail") throw new Error("own commitment must have detail");
        const habit = habits.get(row.habitId);
        if (!habit) throw new Error(`no habit for commitment ${row.commitmentId}`);
        return {
          commitmentId: row.commitmentId,
          habitId: row.habitId,
          habitName: habit.name,
          icon: habit.icon,
          points: row.points,
          consistencyPercent: row.consistency,
          idealPercent: row.idealCompletion,
          automaticity: journey.get(row.commitmentId) ?? { from: null, to: null },
          stage: stages.get(row.commitmentId) ?? "new",
        };
      });

      return ok({
        seasonId: season.id,
        status: season.status,
        lengthWeeks: season.lengthWeeks,
        actualStart: start,
        lastDay,
        totals: {
          points: own.points,
          consistencyPercent: own.consistency,
          idealPercent: own.idealCompletion,
        },
        standings: standingOf(ranked.rows, member.id, ranked.eligibleParticipantCount),
        commitments,
        closingReviewDone: await closingReviewDone(repos, season, member.id),
        closure:
          closure === null ? null : { decidedAt: closure.decidedAt, decisions: closure.decisions },
      });
    },
  );
}
