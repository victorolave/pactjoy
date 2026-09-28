import type { CommitmentId } from "@pactjoy/engine";
import { findActiveMember } from "../circle/circle.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Season } from "../season/season.ts";
import type { Actor } from "../shared/actor.ts";
import type { SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";

export interface RemoveCommitmentDeps {
  readonly uow: UnitOfWork<Repositories>;
}

export interface RemoveCommitmentInput {
  readonly seasonId: SeasonId;
  readonly commitmentId: CommitmentId;
}

export type RemoveCommitmentError =
  | { readonly kind: "SeasonNotFound" }
  | { readonly kind: "NotAMember" }
  | { readonly kind: "PactNotOpen" }
  | { readonly kind: "CommitmentNotFound" }
  | { readonly kind: "NotOwner" };

/**
 * Removes `actor`'s own commitment (SS-13-delta, SS-16-delta) while the
 * pact is still open (SS-15-delta) -- same aggregate-mutation shape as
 * `add-commitment.ts`/`edit-commitment.ts`.
 *
 * SEAM (S6): removing a commitment is supposed to reset all pact approvals
 * (SS-13, PA-2) -- same documented stub as `add-commitment.ts`,
 * `edit-commitment.ts`, `edit-season-params.ts` and `join-circle.ts`;
 * whichever slice adds `Season.approvals` (S6) must also call the
 * approval-reset here.
 */
export async function removeCommitment(
  deps: RemoveCommitmentDeps,
  actor: Actor,
  input: RemoveCommitmentInput,
): Promise<Result<Season, RemoveCommitmentError>> {
  return deps.uow.transaction(async (repos): Promise<Result<Season, RemoveCommitmentError>> => {
    const season = await repos.seasons.get(input.seasonId);
    if (!season) {
      return err({ kind: "SeasonNotFound" });
    }

    const circle = await repos.circles.get(season.circleId);
    const member = circle ? findActiveMember(circle, actor.userId) : undefined;
    if (!member) {
      return err({ kind: "NotAMember" });
    }

    if (season.status !== "pactOpen") {
      return err({ kind: "PactNotOpen" });
    }

    const existing = season.commitments.find((commitment) => commitment.id === input.commitmentId);
    if (!existing) {
      return err({ kind: "CommitmentNotFound" });
    }
    if (existing.memberId !== member.id) {
      return err({ kind: "NotOwner" });
    }

    const updated: Season = {
      ...season,
      commitments: season.commitments.filter((commitment) => commitment.id !== input.commitmentId),
      version: season.version + 1,
    };
    await repos.seasons.save(updated, season.version);
    return ok(updated);
  });
}
