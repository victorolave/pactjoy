import type { CommitmentId } from "@pactjoy/engine";
import { findActiveMember } from "../../circle/circle.ts";
import type { Habit } from "../../habit/habit.ts";
import type { IdGenerator } from "../../ports/id-generator.ts";
import type { Repositories } from "../../ports/repositories.ts";
import type { UnitOfWork } from "../../ports/unit-of-work.ts";
import { pendingReviewOf } from "../../review/pending-review.ts";
import type { Actor } from "../../shared/actor.ts";
import { type HabitId, type SeasonId, seasonClosureId } from "../../shared/ids.ts";
import { err, ok, type Result } from "../../shared/result.ts";
import type { Clock } from "../../time/clock.port.ts";
import type { LocalDate } from "../../time/local-date.ts";
import type { TimeZone } from "../../time/time-zone.port.ts";
import { finalizeIfReady } from "./finalize.ts";
import { closeDatesOf, seasonCloseCalendar, seasonCloseDay } from "./season-calendar.ts";
import {
  type CommitmentClosureDecision,
  isClosureDecision,
  type SeasonClosure,
} from "./season-closure.ts";

export interface SubmitSeasonClosureDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly timeZone: TimeZone;
}

/** One decision as it arrives: validated here at runtime, because it comes from an arbitrary body. */
export interface SubmittedDecision {
  readonly commitmentId: CommitmentId;
  readonly decision: string;
}

export interface SubmitSeasonClosureInput {
  readonly seasonId: SeasonId;
  readonly decisions: readonly SubmittedDecision[];
}

export interface SubmitSeasonClosureResult {
  readonly closure: SeasonClosure;
  /** The habits this closure graduated now (already graduated ones are not listed). */
  readonly graduatedHabitIds: readonly HabitId[];
  /** `true` when this submit completed the circle and wrote `closed` onto the season. */
  readonly seasonClosed: boolean;
}

export type SubmitSeasonClosureError =
  | { readonly kind: "SeasonNotFound" }
  | { readonly kind: "NotAMember" }
  | { readonly kind: "SeasonNotActive" }
  | { readonly kind: "SeasonResultsNotYet"; readonly availableOn: LocalDate }
  | { readonly kind: "NothingToClose" }
  | { readonly kind: "ClosingReviewRequired" }
  | { readonly kind: "ClosureAlreadySubmitted" }
  | { readonly kind: "CommitmentNotOwned" }
  | { readonly kind: "InvalidClosureDecision"; readonly commitmentId: CommitmentId }
  | { readonly kind: "ClosureIncomplete"; readonly commitmentIds: readonly CommitmentId[] };

/**
 * The member's single, final closure of an ended season (screens 37-38b): one decision per own
 * Commitment, plus the graduation of the habits they graduate. One transaction; a rejection stores
 * and graduates nothing. Checks, in this order: the member, the season is `active`, the results day
 * has come (`SeasonResultsNotYet`, the grace day is too early), the member holds commitments, their
 * closing review is done, they have not closed yet, and then, once the season's version is
 * guarded, that the decisions cover exactly the member's commitments.
 *
 * The version guard is taken FIRST so two last closers are serialized: the second one reads the
 * first one's committed row and writes `closed`. The season is finalized here only when this
 * submit completes the circle (never on `stale`: that cuts laggards off only when the next season
 * opens). A closure never touches points, standings or Entries.
 */
export async function submitSeasonClosure(
  deps: SubmitSeasonClosureDeps,
  actor: Actor,
  input: SubmitSeasonClosureInput,
): Promise<Result<SubmitSeasonClosureResult, SubmitSeasonClosureError>> {
  return deps.uow.transaction(
    async (repos): Promise<Result<SubmitSeasonClosureResult, SubmitSeasonClosureError>> => {
      const season = await repos.seasons.get(input.seasonId);
      if (!season) return err({ kind: "SeasonNotFound" });
      const circle = await repos.circles.get(season.circleId);
      const member = circle ? findActiveMember(circle, actor.userId) : undefined;
      if (!circle || !member) return err({ kind: "NotAMember" });
      const start = season.actualStart;
      if (season.status !== "active" || start === null) return err({ kind: "SeasonNotActive" });

      const now = deps.clock.now();
      const day = seasonCloseDay(season, now, deps.timeZone);
      const { resultsFrom } = seasonCloseCalendar(season.lengthWeeks);
      const dates = closeDatesOf(season);
      if (dates === null) return err({ kind: "SeasonNotActive" });
      if (day.kind === "beforeStart" || day.day < resultsFrom) {
        return err({ kind: "SeasonResultsNotYet", availableOn: dates.resultsOn });
      }

      const own = season.commitments.filter((commitment) => commitment.memberId === member.id);
      if (own.length === 0) return err({ kind: "NothingToClose" });

      const review = await pendingReviewOf(repos, {
        season,
        memberId: member.id,
        today: deps.timeZone.localDateAt(now, season.timeZone),
      });
      if (review.pendingReview?.kind === "closing") return err({ kind: "ClosingReviewRequired" });

      if ((await repos.seasonClosures.getMine(season.id, member.id)) !== null) {
        return err({ kind: "ClosureAlreadySubmitted" });
      }

      // Serializes concurrent closers and any writer of the season (FOR NO KEY UPDATE in Postgres).
      await repos.seasons.guardVersion(season.id, season.version);

      const chosen = new Map<CommitmentId, CommitmentClosureDecision["decision"]>();
      const owned = new Set(own.map((commitment) => commitment.id));
      for (const submitted of input.decisions) {
        if (!owned.has(submitted.commitmentId)) return err({ kind: "CommitmentNotOwned" });
        if (chosen.has(submitted.commitmentId) || !isClosureDecision(submitted.decision)) {
          return err({ kind: "InvalidClosureDecision", commitmentId: submitted.commitmentId });
        }
        chosen.set(submitted.commitmentId, submitted.decision);
      }
      const missing = own.filter((commitment) => !chosen.has(commitment.id));
      if (missing.length > 0) {
        return err({
          kind: "ClosureIncomplete",
          commitmentIds: missing.map((commitment) => commitment.id),
        });
      }

      // Every graduation is validated before anything is written.
      const toGraduate: Habit[] = [];
      for (const commitment of own) {
        if (chosen.get(commitment.id) !== "graduate") continue;
        const habit = await repos.habits.get(commitment.habitId);
        if (habit === null || habit.ownerId !== actor.userId) {
          return err({ kind: "CommitmentNotOwned" });
        }
        if (habit.graduatedAt === null && !toGraduate.some((h) => h.id === habit.id)) {
          toGraduate.push(habit);
        }
      }

      const decisions = own.map((commitment): CommitmentClosureDecision => {
        const decision = chosen.get(commitment.id);
        if (decision === undefined) throw new Error(`decision for ${commitment.id} vanished`);
        return { commitmentId: commitment.id, decision };
      });
      const closure: SeasonClosure = {
        id: seasonClosureId(deps.ids.next()),
        seasonId: season.id,
        memberId: member.id,
        decisions,
        decidedAt: now,
        version: 0,
      };
      await repos.seasonClosures.save(closure, null);
      for (const habit of toGraduate) {
        await repos.habits.save(
          { ...habit, graduatedAt: now, version: habit.version + 1 },
          habit.version,
        );
      }
      const finalized = await finalizeIfReady(repos, season, circle, day, "complete");
      return ok({
        closure,
        graduatedHabitIds: toGraduate.map((habit) => habit.id),
        seasonClosed: finalized.finalized,
      });
    },
  );
}
