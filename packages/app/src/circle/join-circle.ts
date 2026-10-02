import { resetApprovals } from "../pact/reset-approvals.ts";
import type { IdGenerator } from "../ports/id-generator.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Actor } from "../shared/actor.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import { activeMembers, type Circle, MAX_MEMBERS, type Member, memberId } from "./circle.ts";
import { isDisplayNameTaken, normalizeDisplayName } from "./display-name.ts";
import { normalizeInviteCode } from "./invite-code.ts";
import { canJoinCircle } from "./season-gate.ts";

export interface JoinCircleDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

export interface JoinCircleInput {
  readonly inviteCode: string;
  readonly displayName: string;
}

export type JoinCircleError =
  | { readonly kind: "InviteNotFound" }
  | { readonly kind: "InviteExpired" }
  | { readonly kind: "CircleArchived" }
  | { readonly kind: "AlreadyInActiveCircle" }
  | { readonly kind: "SeasonNotJoinable" }
  | { readonly kind: "CircleFull" }
  | { readonly kind: "InvalidDisplayName" }
  | { readonly kind: "DisplayNameTaken" };

/**
 * Joins a circle via a valid, unexpired invite code (CM-3..CM-5, CM-9..
 * CM-11). Joining while the pact is open resets all pact approvals (CM-8,
 * PA-5): the season is written in the same transaction as the circle, and
 * ALWAYS so while the pact is open (even with no approvals recorded yet),
 * so a concurrent approval can never commit over the membership change
 * unnoticed -- the loser gets `ConcurrencyConflict` (D5).
 */
export async function joinCircle(
  deps: JoinCircleDeps,
  actor: Actor,
  input: JoinCircleInput,
): Promise<Result<Circle, JoinCircleError>> {
  return deps.uow.transaction(async (repos): Promise<Result<Circle, JoinCircleError>> => {
    const normalizedCode = normalizeInviteCode(input.inviteCode);
    const circle = await repos.circles.findByInviteCode(normalizedCode);
    if (!circle?.invite) {
      return err({ kind: "InviteNotFound" });
    }

    if (circle.archivedAt !== null) {
      return err({ kind: "CircleArchived" });
    }

    const now = deps.clock.now();
    if (circle.invite.expiresAt <= now) {
      return err({ kind: "InviteExpired" });
    }

    const existingActive = await repos.circles.findActiveByUser(actor.userId);
    if (existingActive) {
      return err({ kind: "AlreadyInActiveCircle" });
    }

    // One read of the season drives BOTH the join gate and the approval
    // reset below: reading them separately would let a pact close in
    // between and let someone join an already-active season.
    const latestSeason = await repos.seasons.findLatestByCircle(circle.id);
    if (!canJoinCircle(latestSeason?.status ?? "noSeason")) {
      return err({ kind: "SeasonNotJoinable" });
    }

    if (activeMembers(circle).length >= MAX_MEMBERS) {
      return err({ kind: "CircleFull" });
    }

    const displayName = normalizeDisplayName(input.displayName);
    if (displayName === null) {
      return err({ kind: "InvalidDisplayName" });
    }
    if (isDisplayNameTaken(circle, displayName)) {
      return err({ kind: "DisplayNameTaken" });
    }

    const newMember: Member = {
      id: memberId(deps.ids.next()),
      userId: actor.userId,
      displayName,
      status: "active",
      joinedAt: now,
      leftAt: null,
    };
    const updated: Circle = {
      ...circle,
      members: [...circle.members, newMember],
      version: circle.version + 1,
    };
    await repos.circles.save(updated, circle.version);

    if (latestSeason?.status === "pactOpen") {
      await repos.seasons.save(
        { ...resetApprovals(latestSeason), version: latestSeason.version + 1 },
        latestSeason.version,
      );
    }
    return ok(updated);
  });
}
