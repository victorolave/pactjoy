import type { MemberId } from "@pactjoy/engine";
import { displayPoints, rankStandings, scoreMember } from "@pactjoy/engine";
import type { Actor } from "../shared/actor.ts";
import type { SeasonId } from "../shared/ids.ts";
import { ok, type Result } from "../shared/result.ts";
import {
  loadScoreContext,
  type ScoreContextError,
  type ScoreData,
  type ScoreQueryDeps,
  type StartedScoreContext,
} from "./score-context.ts";
import { toScoreInput } from "./score-input.ts";

export type StandingsDeps = ScoreQueryDeps;

export interface StandingsInput {
  readonly seasonId: SeasonId;
}

export type StandingsError = ScoreContextError;

export interface StandingsRowView {
  readonly memberId: MemberId;
  /** The member's per-circle name; `userId` is never exposed. */
  readonly displayName: string;
  /** Members with the same displayed points share a rank. */
  readonly rank: number;
  readonly points: number;
}

export type StandingsView =
  | { readonly kind: "notStarted" }
  | {
      readonly kind: "ranked";
      readonly rows: readonly StandingsRowView[];
      /**
       * T2: how many members are ranked. Whether to hide the standings when
       * only one is left (SQ-5) is a presentation rule, so the full rows are
       * always returned and the client decides.
       */
      readonly eligibleParticipantCount: number;
    };

/**
 * The ranking core of {@link standings}: synchronous, over data the caller
 * already loaded, so it composes inside any `uow.read` (SQ-R10).
 */
export function standingsView(
  started: StartedScoreContext,
  data: ScoreData,
): Extract<StandingsView, { kind: "ranked" }> {
  const { season, circle, start } = started;
  const participants = circle.members
    .filter((member) => season.commitments.some((commitment) => commitment.memberId === member.id))
    .map((member) => ({
      memberId: member.id,
      status: member.status,
      points: scoreMember(
        toScoreInput({
          season,
          actualStart: start.actualStart,
          memberId: member.id,
          entries: data.entries,
          pauses: data.pauses,
          today: start.today,
        }),
      ).points,
    }));
  const names = new Map(circle.members.map((member) => [member.id, member.displayName]));
  const rows = rankStandings(participants).map((row) => ({
    memberId: row.memberId,
    displayName: names.get(row.memberId) ?? "",
    rank: row.rank,
    points: displayPoints(row.points),
  }));
  return { kind: "ranked", rows, eligibleParticipantCount: rows.length };
}

/**
 * The season's standings (Clasificacion), ranked by points. Recomputed from
 * Entries on every call, pauses included (P2-2, SQ-8). Participants are the
 * circle's members who hold at least one commitment in the season; a member
 * who left is handed to the engine with `status: "left"` and dropped by its
 * eligibility filter (engine Q3, SQ-4): leavers are not ranked. Any active member or season participant may read them, including after leaving the circle (read-only).
 */
export async function standings(
  deps: StandingsDeps,
  actor: Actor,
  input: StandingsInput,
): Promise<Result<StandingsView, StandingsError>> {
  return deps.uow.read(async (repos) => {
    const context = await loadScoreContext(deps, repos, actor, input.seasonId);
    if (!context.ok) {
      return context;
    }
    const { season, start } = context.value;
    if (start === null) {
      return ok({ kind: "notStarted" });
    }
    const entries = await repos.entries.listBySeason(season.id);
    const pauses = await repos.pauses.listBySeason(season.id);
    return ok(standingsView({ ...context.value, start }, { entries, pauses }));
  });
}
