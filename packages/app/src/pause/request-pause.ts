import {
  type CommitmentId,
  canRequestPause,
  type Season as EngineSeason,
  pauseBudget,
  type SeasonDay,
} from "@pactjoy/engine";
import { findActiveMember } from "../circle/circle.ts";
import { exceedsNoteLimit, isStorableNote, normalizeNote } from "../entry/entry.ts";
import type { IdGenerator } from "../ports/id-generator.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import { startWeekdayOf } from "../score/score-input.ts";
import type { Actor } from "../shared/actor.ts";
import { pauseRequestId, type SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import { instant } from "../time/instant.ts";
import type { LocalDate } from "../time/local-date.ts";
import { toSeasonDay } from "../time/season-calendar.ts";
import type { TimeZone } from "../time/time-zone.port.ts";
import { effectiveDecision } from "./effective-decision.ts";
import {
  approversOf,
  loadEffectivePauses,
  type PauseContext,
  seasonDayAt,
} from "./effective-pauses.ts";
import { enqueuePauseRequested } from "./pause-notices.ts";
import { overlapsExisting } from "./pause-overlap.ts";
import {
  AUTO_APPROVE_AFTER_MS,
  PAUSE_REASONS,
  type PauseEnd,
  type PauseReason,
  type PauseRequestRecord,
} from "./pause-request.ts";
import { withDecision } from "./pause-write.ts";
import { plannedBudgetHistory } from "./planned-budget.ts";
import { settleSeasonPauses } from "./settle.ts";

export interface RequestPauseDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly clock: Clock;
  readonly timeZone: TimeZone;
  readonly ids: IdGenerator;
}

/** One Commitment, or "Todos": every Commitment the actor has in the season. */
export type PauseScope =
  | { readonly kind: "all" }
  | { readonly kind: "commitment"; readonly commitmentId: CommitmentId };

export interface RequestPauseInput {
  readonly seasonId: SeasonId;
  readonly scope: PauseScope;
  /** Validated here at runtime: it arrives from an arbitrary body. */
  readonly reason: string;
  readonly note: string | null;
  /** The first day, in the season's timezone; today or later. */
  readonly startDate: LocalDate;
  /** The last day, or `null` for an open pause ("until I resume"). */
  readonly endDate: LocalDate | null;
}

/** Why a Commitment cannot take the days it was asked for. */
export interface PauseCapFailure {
  readonly commitmentId: CommitmentId;
  readonly reason: "capExhausted" | "exceedsRemainingCap";
  readonly remainingDays: number;
}

export type RequestPauseError =
  | { readonly kind: "SeasonNotFound" }
  | { readonly kind: "NotAMember" }
  | { readonly kind: "SeasonNotActive" }
  | { readonly kind: "InvalidPauseReason" }
  | { readonly kind: "InvalidPauseScope" }
  | { readonly kind: "NoteTooLong" }
  | { readonly kind: "InvalidNote" }
  | { readonly kind: "CommitmentNotOwned" }
  | { readonly kind: "PauseRetroactive" }
  | { readonly kind: "PauseEndBeforeStart" }
  | { readonly kind: "PauseEndsAfterSeason" }
  | { readonly kind: "PauseOverlaps"; readonly commitmentIds: readonly CommitmentId[] }
  | { readonly kind: "PauseCapExceeded"; readonly commitments: readonly PauseCapFailure[] };

const DAYS_PER_WEEK = 7;

function isPauseReason(value: string): value is PauseReason {
  return (PAUSE_REASONS as readonly string[]).includes(value);
}

/**
 * Asks the circle to Pause one Commitment, or all of the actor's ("Todos",
 * ONE request and ONE decision, PL-5). The request starts `pending` with
 * `autoApproveAt` exactly 48 h later (PL-6), except in a solo circle, where
 * nobody can approve and it is approved at once (Q1).
 *
 * Serialization (ADR-0013, D9): the circle and the season are guarded
 * (FOR NO KEY UPDATE on Postgres) BEFORE the requests are listed, so two
 * concurrent requests on one Commitment queue up and the second sees the
 * first's row: the overlap (Q5) and cap checks are race-free. The season
 * version is NOT bumped. Settlement runs first (settle-first), inside the
 * same transaction. A request that exceeds the cap on ANY Commitment of the
 * scope is refused whole (Q11) and nothing is stored.
 */
export async function requestPause(
  deps: RequestPauseDeps,
  actor: Actor,
  input: RequestPauseInput,
): Promise<Result<PauseRequestRecord, RequestPauseError>> {
  return deps.uow.transaction(
    async (repos): Promise<Result<PauseRequestRecord, RequestPauseError>> => {
      const season = await repos.seasons.get(input.seasonId);
      if (!season) return err({ kind: "SeasonNotFound" });
      const circle = await repos.circles.get(season.circleId);
      const member = circle ? findActiveMember(circle, actor.userId) : undefined;
      if (!circle || !member) return err({ kind: "NotAMember" });

      // Lock order: circle, then season, then the pause rows (D9).
      await repos.circles.guardVersion(circle.id, circle.version);
      await repos.seasons.guardVersion(season.id, season.version);

      if (season.status !== "active" || season.actualStart === null) {
        return err({ kind: "SeasonNotActive" });
      }
      const actualStart = season.actualStart;

      if (!isPauseReason(input.reason)) return err({ kind: "InvalidPauseReason" });
      const reason = input.reason;
      const note = normalizeNote(input.note);
      if (!isStorableNote(note)) return err({ kind: "InvalidNote" });
      if (exceedsNoteLimit(note)) return err({ kind: "NoteTooLong" });

      const mine = season.commitments.filter((c) => c.memberId === member.id);
      let scoped: readonly CommitmentId[];
      if (input.scope.kind === "all") {
        if (mine.length === 0) return err({ kind: "InvalidPauseScope" });
        scoped = mine.map((c) => c.id);
      } else if (input.scope.kind === "commitment") {
        const wanted = input.scope.commitmentId;
        if (!mine.some((c) => c.id === wanted)) return err({ kind: "CommitmentNotOwned" });
        scoped = [wanted];
      } else {
        return err({ kind: "InvalidPauseScope" });
      }

      const now = deps.clock.now();
      const context: PauseContext = { season, circle, now, timeZone: deps.timeZone };
      const lastSeasonDay = season.lengthWeeks * DAYS_PER_WEEK - 1;
      const todayResult = toSeasonDay(deps.timeZone.localDateAt(now, season.timeZone), actualStart);
      if (todayResult.kind === "beforeStart" || todayResult.day > lastSeasonDay) {
        return err({ kind: "SeasonNotActive" });
      }
      const today = todayResult.day;

      const start = toSeasonDay(input.startDate, actualStart);
      if (start.kind === "beforeStart" || start.day < today)
        return err({ kind: "PauseRetroactive" });
      if (start.day > lastSeasonDay) return err({ kind: "PauseEndsAfterSeason" });
      let end: PauseEnd = { kind: "open" };
      if (input.endDate !== null) {
        const last = toSeasonDay(input.endDate, actualStart);
        if (last.kind === "beforeStart" || last.day < start.day) {
          return err({ kind: "PauseEndBeforeStart" });
        }
        if (last.day > lastSeasonDay) return err({ kind: "PauseEndsAfterSeason" });
        end = { kind: "fixed", lastDay: last.day };
      }

      await settleSeasonPauses(repos, context);
      const history = await loadEffectivePauses(repos, context);
      const engineSeason: EngineSeason = {
        lengthWeeks: season.lengthWeeks,
        startWeekday: startWeekdayOf(actualStart),
      };
      const historyOf = (commitmentId: CommitmentId) =>
        history.filter((p) => p.memberId === member.id && p.commitmentId === commitmentId);
      // The cap counts every PLANNED day, including a future fixed span.
      const plannedOf = (commitmentId: CommitmentId) =>
        plannedBudgetHistory(historyOf(commitmentId));

      const overlapping = scoped.filter((id) =>
        overlapsExisting(
          { startDay: start.day, lastDay: end.kind === "fixed" ? end.lastDay : null },
          historyOf(id),
          engineSeason,
        ),
      );
      if (overlapping.length > 0) {
        return err({ kind: "PauseOverlaps", commitmentIds: overlapping });
      }

      const failures: PauseCapFailure[] = [];
      for (const id of scoped) {
        const check = canRequestPause(
          engineSeason,
          plannedOf(id),
          { startDay: start.day, end },
          today,
        );
        if (!check.allowed) {
          failures.push({
            commitmentId: id,
            reason: check.reason === "capExhausted" ? "capExhausted" : "exceedsRemainingCap",
            remainingDays: pauseBudget(engineSeason, plannedOf(id), today).remainingDays,
          });
        }
      }
      if (failures.length > 0) return err({ kind: "PauseCapExceeded", commitments: failures });

      const record: PauseRequestRecord = {
        id: pauseRequestId(deps.ids.next()),
        seasonId: season.id,
        memberId: member.id,
        reason,
        note,
        requestedAt: now,
        requestedOn: seasonDayAt(context, now),
        startDay: start.day as SeasonDay,
        end,
        autoApproveAt: instant(now + AUTO_APPROVE_AFTER_MS),
        status: "pending",
        decidedAt: null,
        decidedOn: null,
        commitments: scoped.map((commitmentId) => ({
          commitmentId,
          resumedOn: null,
          resumedAt: null,
        })),
        responses: [],
        version: 0,
      };
      // Q1: nobody to ask means it is decided the moment it is made.
      const decision = effectiveDecision(record, {
        approverIds: approversOf(circle, member.id),
        now,
        dayOf: (at) => seasonDayAt(context, at),
      });
      const decided = withDecision(record, decision);
      await repos.pauses.save(decided, null);
      await enqueuePauseRequested(repos, season, circle, decided, now);
      return ok(decided);
    },
  );
}
