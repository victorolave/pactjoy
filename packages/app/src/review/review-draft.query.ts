import type { CommitmentId } from "@pactjoy/engine";
import { seasonDay } from "@pactjoy/engine";
import { isPaused } from "../entry/on-hold.ts";
import { loadEffectivePauses } from "../pause/effective-pauses.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { Actor } from "../shared/actor.ts";
import type { SeasonId } from "../shared/ids.ts";
import { ok, type Result } from "../shared/result.ts";
import type { LocalDate } from "../time/local-date.ts";
import { toSeasonDay } from "../time/season-calendar.ts";
import { type PeriodSummary, periodSummary } from "./period-summary.ts";
import type { ReviewKind, SrbaiMode } from "./review.ts";
import {
  loadReviewContext,
  type ReviewClockDeps,
  type ReviewContextError,
} from "./review-context.ts";
import { dueUntilOf, type ReviewSlotStatus } from "./review-schedule.ts";

export interface ReviewDraftDeps extends ReviewClockDeps {
  readonly uow: { read<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> };
}

export interface ReviewDraftInput {
  readonly seasonId: SeasonId;
  readonly periodIndex: number;
}

/** A commitment the review asks about. */
export interface ReviewDraftCommitment {
  readonly commitmentId: CommitmentId;
  readonly habitName: string;
  readonly icon: string | null;
  /** Paused (approved) on the day of the review: tagged "(en pausa)", and still asked about (REQ-P1). */
  readonly paused: boolean;
}

/** What the review flow shows before the member answers (screens 33, 34, 35a, 35c, 13). */
export interface ReviewDraftView {
  readonly status: ReviewSlotStatus;
  readonly kind: ReviewKind;
  readonly srbai: SrbaiMode;
  /** The weeks the period covers (1-based, inclusive); `null` for the baseline. */
  readonly weeks: { readonly first: number; readonly last: number } | null;
  /** The last day it can be answered; `null` when it never lapses (the closing review). */
  readonly dueUntil: LocalDate | null;
  /** The live period summary; `null` for the baseline and for a period that has not ended. */
  readonly summary: PeriodSummary | null;
  /** The member's OWN commitments, in season order, private ones included. */
  readonly commitments: readonly ReviewDraftCommitment[];
}

export type ReviewDraftError = ReviewContextError;

/**
 * The owner's view of one review period, read live: the derived status (a due, upcoming, lapsed or
 * already-answered review all read, so the web can say which), the SRBAI mode, the summary of the
 * period recomputed from Entries through the effective pauses (REQ-U2), and the member's
 * commitments with the paused ones tagged. It writes nothing (REQ-R7) and only ever describes the
 * ASKING member: no member id comes from the request (REQ-V1).
 */
export async function reviewDraft(
  deps: ReviewDraftDeps,
  actor: Actor,
  input: ReviewDraftInput,
): Promise<Result<ReviewDraftView, ReviewDraftError>> {
  return deps.uow.read(async (repos): Promise<Result<ReviewDraftView, ReviewDraftError>> => {
    const context = await loadReviewContext(deps, repos, actor, input.seasonId, input.periodIndex);
    if (!context.ok) return context;
    const { season, circle, member, mine, slot, actualStart, today, now } = context.value;

    const pauses = await loadEffectivePauses(repos, {
      season,
      circle,
      now,
      timeZone: deps.timeZone,
    });
    const habits = await repos.habits.getMany(mine.map((commitment) => commitment.habitId));
    const todayDay = toSeasonDay(today, actualStart);
    const lastDay = season.lengthWeeks * 7 - 1;
    // The review day, kept inside the season for the pause lookup (a closing review is read after it).
    const reviewDay =
      todayDay.kind === "beforeStart"
        ? null
        : seasonDay(todayDay.day > lastDay ? lastDay : todayDay.day);

    const commitments = mine.map((commitment): ReviewDraftCommitment => {
      const habit = habits.find((candidate) => candidate.id === commitment.habitId);
      if (habit === undefined) throw new Error(`habit ${commitment.habitId} not found`);
      const paused =
        todayDay.kind === "day" &&
        reviewDay !== null &&
        isPaused({
          season,
          actualStart,
          commitment,
          day: reviewDay,
          today: todayDay.day,
          pauses: pauses.filter((pause) => pause.commitmentId === commitment.id),
        });
      return {
        commitmentId: commitment.id,
        habitName: habit.name,
        icon: habit.icon,
        paused,
      };
    });

    const ended =
      slot.dueFromDay !== null && todayDay.kind === "day" && todayDay.day + 1 >= slot.dueFromDay;
    const summary =
      slot.firstWeek !== null && slot.lastWeek !== null && ended && todayDay.kind === "day"
        ? periodSummary({
            season,
            actualStart,
            memberId: member.id,
            habits,
            entries: await repos.entries.listBySeason(season.id),
            pauses,
            today: todayDay.day,
            firstWeek: slot.firstWeek,
            lastWeek: slot.lastWeek,
          })
        : null;

    return ok({
      status: slot.status,
      kind: slot.kind,
      srbai: slot.srbai,
      weeks:
        slot.firstWeek !== null && slot.lastWeek !== null
          ? { first: slot.firstWeek, last: slot.lastWeek }
          : null,
      dueUntil: dueUntilOf(slot, actualStart),
      summary,
      commitments,
    });
  });
}
