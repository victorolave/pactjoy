import { type CommitmentId, displayPoints, pauseBudget, scoreMember } from "@pactjoy/engine";
import type { ScoreQueryDeps } from "../score/score-context.ts";
import { startWeekdayOf, toScoreInput } from "../score/score-input.ts";
import type { Actor } from "../shared/actor.ts";
import type { PauseRequestId, SeasonId } from "../shared/ids.ts";
import { toSeasonDay } from "../time/season-calendar.ts";
import {
  type EffectivePauseRequest,
  loadEffectiveRequests,
  type PauseContext,
} from "./effective-pauses.ts";
import type { MemberPauseRequest } from "./pause-request.repository.ts";
import type { PauseRequestRecord, PauseResponseChoice } from "./pause-request.ts";
import { withDecision } from "./pause-write.ts";
import { toEnginePauses } from "./to-engine.ts";

export type MyPauseRequestsDeps = ScoreQueryDeps;

/** A pending request of someone else, with the viewer's current answer to it. */
export interface AwaitingPauseRequest {
  readonly request: PauseRequestRecord;
  /** `null` until the viewer answers; can flip while pending (Q3). */
  readonly myResponse: PauseResponseChoice | null;
}

/** One Commitment's pause allowance as of today (D10). */
export interface PauseBudgetView {
  readonly commitmentId: CommitmentId;
  readonly cap: number;
  readonly usedDays: number;
  readonly remainingDays: number;
}

/**
 * 30b data (D11, PS-14, TR-5): the viewer's points with and without their
 * latest approved request, each scored exactly and rounded once. Per
 * Commitment only for the ones that request covers.
 */
export interface PauseRedistribution {
  readonly pauseRequestId: PauseRequestId;
  readonly total: { readonly before: number; readonly after: number };
  readonly commitments: readonly {
    readonly commitmentId: CommitmentId;
    readonly before: number;
    readonly after: number;
  }[];
}

export interface MyPauseRequestsView {
  /** The viewer's started season; `null` when there is none (the view is then empty). */
  readonly seasonId: SeasonId | null;
  /** The viewer's own requests, oldest first, each with its effective status at the clock. */
  readonly mine: readonly PauseRequestRecord[];
  /** Pending requests of others the viewer is asked about. */
  readonly awaitingMe: readonly AwaitingPauseRequest[];
  /** One per Commitment of the viewer. */
  readonly budgets: readonly PauseBudgetView[];
  readonly redistributed: PauseRedistribution | null;
}

const EMPTY: MyPauseRequestsView = {
  seasonId: null,
  mine: [],
  awaitingMe: [],
  budgets: [],
  redistributed: null,
};

/**
 * What the pause screens need, in ONE read (PA-2): the viewer's requests, the
 * ones awaiting their answer, their budgets and the 30b comparison. Total: no
 * circle, or no started season, gives an empty view. Statuses are the
 * EFFECTIVE ones at the clock, derived with no prior write (PA-8); a read
 * never writes.
 */
export async function myPauseRequests(
  deps: MyPauseRequestsDeps,
  actor: Actor,
): Promise<MyPauseRequestsView> {
  return deps.uow.read(async (repos): Promise<MyPauseRequestsView> => {
    const circle = await repos.circles.findActiveByUser(actor.userId);
    const viewer = circle?.members.find((m) => m.userId === actor.userId && m.status === "active");
    const season = circle ? await repos.seasons.findLatestByCircle(circle.id) : null;
    if (
      !circle ||
      !viewer ||
      !season ||
      season.status !== "active" ||
      season.actualStart === null
    ) {
      return EMPTY;
    }
    const actualStart = season.actualStart;
    const now = deps.clock.now();
    const todayResult = toSeasonDay(deps.timeZone.localDateAt(now, season.timeZone), actualStart);
    if (todayResult.kind === "beforeStart") return EMPTY;
    const today = todayResult.day;

    const context: PauseContext = { season, circle, now, timeZone: deps.timeZone };
    const effective = await loadEffectiveRequests(repos, context);
    const own = effective.filter(({ record }) => record.memberId === viewer.id);

    const mine = own.map(({ record, decision }) => withDecision(record, decision));
    const awaitingMe = effective
      .filter(
        ({ record, decision }) => record.memberId !== viewer.id && decision.status === "pending",
      )
      .map(({ record }) => ({
        request: record,
        myResponse: record.responses.find((r) => r.memberId === viewer.id)?.response ?? null,
      }));

    const engineSeason = {
      lengthWeeks: season.lengthWeeks,
      startWeekday: startWeekdayOf(actualStart),
    };
    const ownPauses = own.flatMap(({ record, decision }) => toEnginePauses(record, decision));
    const budgets = season.commitments
      .filter((c) => c.memberId === viewer.id)
      .map((c) => ({
        commitmentId: c.id,
        ...pauseBudget(
          engineSeason,
          ownPauses.filter((p) => p.commitmentId === c.id),
          today,
        ),
      }));

    const latest = latestApproved(own);
    const redistributed = latest
      ? await redistribution({
          latest,
          effective,
          score: async (pauses) =>
            scoreMember(
              toScoreInput({
                season,
                actualStart,
                memberId: viewer.id,
                entries: await repos.entries.listBySeason(season.id),
                pauses,
                today,
              }),
            ),
        })
      : null;

    return { seasonId: season.id, mine, awaitingMe, budgets, redistributed };
  });
}

/** The viewer's most recently approved request (ties go to the later one). */
function latestApproved(own: readonly EffectivePauseRequest[]): EffectivePauseRequest | null {
  let latest: EffectivePauseRequest | null = null;
  for (const candidate of own) {
    if (candidate.decision.status !== "approved") continue;
    if (
      latest === null ||
      latest.decision.status !== "approved" ||
      candidate.decision.decidedAt >= latest.decision.decidedAt
    ) {
      latest = candidate;
    }
  }
  return latest;
}

async function redistribution(args: {
  readonly latest: EffectivePauseRequest;
  readonly effective: readonly EffectivePauseRequest[];
  readonly score: (
    pauses: readonly MemberPauseRequest[],
  ) => Promise<ReturnType<typeof scoreMember>>;
}): Promise<PauseRedistribution> {
  const { latest, effective, score } = args;
  const every = effective.flatMap(({ record, decision }) => toEnginePauses(record, decision));
  const without = effective
    .filter(({ record }) => record.id !== latest.record.id)
    .flatMap(({ record, decision }) => toEnginePauses(record, decision));
  const [after, before] = [await score(every), await score(without)];
  const pointsOf = (s: typeof after, id: CommitmentId) => {
    const found = s.commitments.find((c) => c.commitmentId === id);
    if (!found) throw new Error(`engine returned no score for commitment ${id}`);
    return displayPoints(found.points);
  };
  return {
    pauseRequestId: latest.record.id,
    total: { before: displayPoints(before.points), after: displayPoints(after.points) },
    commitments: latest.record.commitments.map(({ commitmentId }) => ({
      commitmentId,
      before: pointsOf(before, commitmentId),
      after: pointsOf(after, commitmentId),
    })),
  };
}
