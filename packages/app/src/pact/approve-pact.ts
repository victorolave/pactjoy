import type { MemberId } from "@pactjoy/engine";
import { activeMembers, findActiveMember } from "../circle/circle.ts";
import { commitmentsSumToFullWeight } from "../commitment/commitment.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { PactApproval, Season } from "../season/season.ts";
import type { Actor } from "../shared/actor.ts";
import type { SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import type { TimeZone } from "../time/time-zone.port.ts";
import { closeSeason, isUnanimouslyApproved } from "./close-pact.ts";

export interface ApprovePactDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly clock: Clock;
  readonly timeZone: TimeZone;
}

export interface ApprovePactInput {
  readonly seasonId: SeasonId;
}

export type ApprovePactError =
  | { readonly kind: "SeasonNotFound" }
  | { readonly kind: "NotAMember" }
  | { readonly kind: "PactNotOpen" }
  | { readonly kind: "CommitmentWeightsNotFull" };

/** Upserts `memberId`'s approval by replacing any existing entry (re-approving just refreshes `approvedAt`, never duplicates). */
function upsertApproval(
  approvals: readonly PactApproval[],
  memberId: MemberId,
  approvedAt: PactApproval["approvedAt"],
): readonly PactApproval[] {
  const withoutExisting = approvals.filter((approval) => approval.memberId !== memberId);
  return [...withoutExisting, { memberId, approvedAt }];
}

/**
 * Records `actor`'s approval of the pact (PA-1, PA-9, new PA-10/B5, new
 * PA-11/B4). Requires the approving member's OWN commitment weights to sum
 * to exactly 100% (B5) -- a member with zero commitments always fails this
 * (`commitmentsSumToFullWeight([])` is 0, never 100), so no separate check
 * is needed. Once every currently active member has an approval recorded
 * (unanimity, works identically for a solo circle, B4), the pact closes
 * via `close-pact.ts`'s `closeSeason` (B3-corrected start shift, A6 length
 * kept). Only touches the `Season` aggregate -- `Circle` is read-only here,
 * so this needs no multi-repo transaction (unlike `join-circle.ts`/
 * `leave-circle.ts`, which also mutate `Season`'s approvals as a seam).
 */
export async function approvePact(
  deps: ApprovePactDeps,
  actor: Actor,
  input: ApprovePactInput,
): Promise<Result<Season, ApprovePactError>> {
  return deps.uow.transaction(async (repos): Promise<Result<Season, ApprovePactError>> => {
    const season = await repos.seasons.get(input.seasonId);
    if (!season) {
      return err({ kind: "SeasonNotFound" });
    }

    const circle = await repos.circles.get(season.circleId);
    const member = circle ? findActiveMember(circle, actor.userId) : undefined;
    if (!member || !circle) {
      return err({ kind: "NotAMember" });
    }

    if (season.status !== "pactOpen") {
      return err({ kind: "PactNotOpen" });
    }

    const ownCommitments = season.commitments.filter(
      (commitment) => commitment.memberId === member.id,
    );
    if (!commitmentsSumToFullWeight(ownCommitments)) {
      return err({ kind: "CommitmentWeightsNotFull" });
    }

    const now = deps.clock.now();
    const approvals = upsertApproval(season.approvals, member.id, now);
    const activeMemberIds = activeMembers(circle).map((activeMember) => activeMember.id);

    let updated: Season;
    if (isUnanimouslyApproved(activeMemberIds, approvals)) {
      const closingDate = deps.timeZone.localDateAt(now, season.timeZone);
      updated = closeSeason(season, approvals, now, closingDate);
    } else {
      updated = { ...season, approvals, version: season.version + 1 };
    }

    await repos.seasons.save(updated, season.version);
    return ok(updated);
  });
}
