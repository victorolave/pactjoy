import type { IdGenerator } from "../ports/id-generator.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Actor } from "../shared/actor.ts";
import { circleId } from "../shared/ids.ts";
import { err, type Result } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import { type BuildCircleError, buildCircle, type Circle, memberId } from "./circle.ts";

export interface CreateCircleDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

export interface CreateCircleInput {
  readonly name: string;
}

export type CreateCircleError = BuildCircleError | { readonly kind: "AlreadyInActiveCircle" };

/**
 * Creates a new circle with `actor` as its sole, active first member (CM-1,
 * CM-2). Rejects when `actor` already belongs to another active circle
 * (A5, CM-11) -- the MVP allows at most one active circle per user.
 */
export async function createCircle(
  deps: CreateCircleDeps,
  actor: Actor,
  input: CreateCircleInput,
): Promise<Result<Circle, CreateCircleError>> {
  return deps.uow.transaction(async (repos): Promise<Result<Circle, CreateCircleError>> => {
    const existing = await repos.circles.findActiveByUser(actor.userId);
    if (existing) {
      return err({ kind: "AlreadyInActiveCircle" });
    }

    const built = buildCircle({
      id: circleId(deps.ids.next()),
      name: input.name,
      creatorId: memberId(deps.ids.next()),
      creatorUserId: actor.userId,
      now: deps.clock.now(),
    });
    if (!built.ok) {
      return built;
    }

    await repos.circles.save(built.value, null);
    return built;
  });
}
