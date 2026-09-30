import { findActiveMember } from "../circle/circle.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Season } from "../season/season.ts";
import type { Actor } from "../shared/actor.ts";
import type { SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";

export interface WithdrawApprovalDeps {
  readonly uow: UnitOfWork<Repositories>;
}

export interface WithdrawApprovalInput {
  readonly seasonId: SeasonId;
}

export type WithdrawApprovalError =
  | { readonly kind: "SeasonNotFound" }
  | { readonly kind: "NotAMember" }
  | { readonly kind: "PactAlreadyClosed" };

/**
 * Withdraws `actor`'s own approval while the pact is still open (A7,
 * PA-3); once the pact has closed, approvals are locked with every other
 * season parameter and this is rejected (PA-4, `PactAlreadyClosed`).
 * Withdrawing when no approval is recorded is an idempotent no-op (user
 * decision, 2026-09-30): no error, no write, no version bump.
 */
export async function withdrawApproval(
  deps: WithdrawApprovalDeps,
  actor: Actor,
  input: WithdrawApprovalInput,
): Promise<Result<Season, WithdrawApprovalError>> {
  return deps.uow.transaction(async (repos): Promise<Result<Season, WithdrawApprovalError>> => {
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
      return err({ kind: "PactAlreadyClosed" });
    }

    if (!season.approvals.some((approval) => approval.memberId === member.id)) {
      return ok(season);
    }

    const approvals = season.approvals.filter((approval) => approval.memberId !== member.id);
    const updated: Season = { ...season, approvals, version: season.version + 1 };
    await repos.seasons.save(updated, season.version);
    return ok(updated);
  });
}
