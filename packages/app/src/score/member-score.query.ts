import type { MemberId } from "@pactjoy/engine";
import { displayPercent, displayPoints, type MemberScore, scoreMember } from "@pactjoy/engine";
import type { Actor } from "../shared/actor.ts";
import type { SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { type CommitmentScoreView, projectCommitment } from "./commitment-projection.ts";
import {
  isParticipant,
  loadScoreContext,
  type ScoreContextError,
  type ScoreQueryDeps,
} from "./score-context.ts";
import { toScoreInput } from "./score-input.ts";

export type MemberScoreDeps = ScoreQueryDeps;

export interface MemberScoreInput {
  readonly seasonId: SeasonId;
  /** Whose score; defaults to the asking member's own. */
  readonly memberId?: MemberId;
}

export type MemberScoreError = ScoreContextError | { readonly kind: "MemberNotFound" };

/** A member's score as shown to a client: already rounded by the engine's display boundary (D10). */
export type MemberScoreView =
  | { readonly kind: "notStarted" }
  | {
      readonly kind: "scored";
      readonly memberId: MemberId;
      readonly points: number;
      /** Percent; `null` while nothing has been counted yet. */
      readonly consistency: number | null;
      /** Percent; `null` while some commitment has nothing counted yet. */
      readonly idealCompletion: number | null;
      /** Every commitment of the member, in season order, as the asking member may see it. */
      readonly commitments: readonly CommitmentScoreView[];
    };

function toView(
  memberId: MemberId,
  score: MemberScore,
  commitments: readonly CommitmentScoreView[],
): MemberScoreView {
  return {
    kind: "scored",
    memberId,
    points: displayPoints(score.points),
    consistency: score.consistency === null ? null : displayPercent(score.consistency),
    idealCompletion: score.idealCompletion === null ? null : displayPercent(score.idealCompletion),
    commitments,
  };
}

/**
 * A circle member's score for a season (SQ-6, SQ-7, SQ-8). Always recomputed
 * from Entries through the engine on every call -- nothing is cached or
 * stored (P2-2) -- with pauses read through the read-only port. The season
 * clock decides "today"; a season that has not started yields `notStarted`.
 * Any active member or season participant may read any participant's score, including after leaving the circle (read-only).
 */
export async function memberScore(
  deps: MemberScoreDeps,
  actor: Actor,
  input: MemberScoreInput,
): Promise<Result<MemberScoreView, MemberScoreError>> {
  return deps.uow.read(async (repos) => {
    const context = await loadScoreContext(deps, repos, actor, input.seasonId);
    if (!context.ok) {
      return context;
    }
    const { season, circle, viewer, start } = context.value;
    const targetId = input.memberId ?? viewer.id;
    const target = circle.members.find(
      (member) => member.id === targetId && isParticipant(season, member.id),
    );
    if (!target) {
      return err({ kind: "MemberNotFound" });
    }
    if (start === null) {
      return ok({ kind: "notStarted" });
    }
    const entries = await repos.entries.listBySeason(season.id);
    const pauses = await repos.pauses.listBySeason(season.id);
    const scoreInput = toScoreInput({
      season,
      actualStart: start.actualStart,
      memberId: target.id,
      entries,
      pauses,
      today: start.today,
    });
    const score = scoreMember(scoreInput);
    const records = season.commitments.filter((commitment) => commitment.memberId === target.id);
    const commitments = records.map((record) => {
      const scored = score.commitments.find((entry) => entry.commitmentId === record.id);
      if (!scored) throw new Error(`engine returned no score for commitment ${record.id}`);
      return projectCommitment(record, scored, viewer.id);
    });
    return ok(toView(target.id, score, commitments));
  });
}
