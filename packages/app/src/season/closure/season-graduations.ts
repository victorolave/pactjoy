import type { CommitmentId, MemberId } from "@pactjoy/engine";
import type { SeasonId } from "../../shared/ids.ts";
import type { Instant } from "../../time/instant.ts";
import type { SeasonClosureRepository } from "./season-closure.repository.ts";

/**
 * One public fact of a season's closures: this member graduated the habit of this commitment, at
 * this instant. It is the ONLY closure data that leaves the module, and only for the graduation
 * announcement of the circle feed (ADR-0018, F8): the other decisions (continue, adjust, pause)
 * and everything else a closure holds stay owner-only (ADR-0015).
 */
export interface SeasonGraduation {
  readonly memberId: MemberId;
  readonly commitmentId: CommitmentId;
  readonly decidedAt: Instant;
}

/** What {@link seasonGraduations} reads: the closure store, narrowed to its two existing reads. */
export interface SeasonGraduationSource {
  readonly seasonClosures: Pick<SeasonClosureRepository, "closedMemberIds" | "getMine">;
}

/**
 * The `graduate` decisions of ONE season, from the closures of the members who closed it. A
 * graduation is a fact of the season in which it was decided: a habit belongs to its owner and can
 * be reused in another circle, so `Habit.graduatedAt` cannot say where it happened. Built only on
 * the port's `closedMemberIds` and `getMine`; the port gains no season-wide read of decisions, and
 * this helper drops every decision that is not a graduation before anything leaves the module.
 */
export async function seasonGraduations(
  repos: SeasonGraduationSource,
  seasonId: SeasonId,
): Promise<readonly SeasonGraduation[]> {
  const graduations: SeasonGraduation[] = [];
  for (const memberId of await repos.seasonClosures.closedMemberIds(seasonId)) {
    const closure = await repos.seasonClosures.getMine(seasonId, memberId);
    if (closure === null) continue;
    for (const { commitmentId, decision } of closure.decisions) {
      if (decision !== "graduate") continue;
      graduations.push({ memberId, commitmentId, decidedAt: closure.decidedAt });
    }
  }
  return graduations;
}
