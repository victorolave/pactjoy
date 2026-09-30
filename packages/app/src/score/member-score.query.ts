import type { MemberId } from "@pactjoy/engine";
import { displayPercent, displayPoints, type MemberScore, scoreMember } from "@pactjoy/engine";
import { activeMembers } from "../circle/circle.ts";
import type { Actor } from "../shared/actor.ts";
import type { SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { loadScoreContext, type ScoreContextError, type ScoreQueryDeps } from "./score-context.ts";
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
    };

export function toView(memberId: MemberId, score: MemberScore): MemberScoreView {
  return {
    kind: "scored",
    memberId,
    points: displayPoints(score.points),
    consistency: score.consistency === null ? null : displayPercent(score.consistency),
    idealCompletion: score.idealCompletion === null ? null : displayPercent(score.idealCompletion),
  };
}

/**
 * A circle member's score for a season (SQ-6, SQ-7, SQ-8). Always recomputed
 * from Entries through the engine on every call -- nothing is cached or
 * stored (P2-2) -- with pauses read through the read-only port. The season
 * clock decides "today"; a season that has not started yields `notStarted`.
 * Any active member of the circle may read any other active member's score.
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
    const target = activeMembers(circle).find(
      (member) => member.id === (input.memberId ?? viewer.id),
    );
    if (!target) {
      return err({ kind: "MemberNotFound" });
    }
    if (start === null) {
      return ok({ kind: "notStarted" });
    }
    const [entries, pauses] = await Promise.all([
      repos.entries.listBySeason(season.id),
      repos.pauses.listBySeason(season.id),
    ]);
    const score = scoreMember(
      toScoreInput({
        season,
        actualStart: start.actualStart,
        memberId: target.id,
        entries,
        pauses,
        today: start.today,
      }),
    );
    return ok(toView(target.id, score));
  });
}
