import { resetApprovals } from "../pact/reset-approvals.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Actor } from "../shared/actor.ts";
import type { CircleId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import { type Circle, findActiveMember, type Member } from "./circle.ts";

export interface LeaveCircleDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly clock: Clock;
}

export interface LeaveCircleInput {
  readonly circleId: CircleId;
}

export type LeaveCircleError =
  | { readonly kind: "CircleNotFound" }
  | { readonly kind: "NotAMember" };

/**
 * Marks `actor` as having left the circle (CM-13, CM-14). While the pact
 * is still open, the leaver's commitments are discarded and every pact
 * approval is reset (CM-13, PA-6), written in the same transaction as the
 * circle (and always, even with no approvals yet, so a concurrent approval
 * can't commit over the change -- `ConcurrencyConflict`, D5). Once the
 * season is active or closed nothing on the season changes: the pact is
 * locked and past data is kept (B9). A member who has already left cannot
 * leave again (`NotAMember`).
 */
export async function leaveCircle(
  deps: LeaveCircleDeps,
  actor: Actor,
  input: LeaveCircleInput,
): Promise<Result<Circle, LeaveCircleError>> {
  return deps.uow.transaction(async (repos): Promise<Result<Circle, LeaveCircleError>> => {
    const circle = await repos.circles.get(input.circleId);
    if (!circle) {
      return err({ kind: "CircleNotFound" });
    }

    const member = findActiveMember(circle, actor.userId);
    if (!member) {
      return err({ kind: "NotAMember" });
    }

    const now = deps.clock.now();
    const members: readonly Member[] = circle.members.map((m) =>
      m.id === member.id ? { ...m, status: "left" as const, leftAt: now } : m,
    );
    const updated: Circle = { ...circle, members, version: circle.version + 1 };
    await repos.circles.save(updated, circle.version);

    const latestSeason = await repos.seasons.findLatestByCircle(circle.id);
    if (latestSeason?.status === "pactOpen") {
      await repos.seasons.save(
        {
          ...resetApprovals(latestSeason),
          commitments: latestSeason.commitments.filter((c) => c.memberId !== member.id),
          version: latestSeason.version + 1,
        },
        latestSeason.version,
      );
    }
    return ok(updated);
  });
}
