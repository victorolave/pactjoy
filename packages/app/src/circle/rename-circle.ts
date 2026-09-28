import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Actor } from "../shared/actor.ts";
import type { CircleId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { type Circle, findActiveMember } from "./circle.ts";

export interface RenameCircleDeps {
  readonly uow: UnitOfWork<Repositories>;
}

export interface RenameCircleInput {
  readonly circleId: CircleId;
  readonly name: string;
}

export type RenameCircleError =
  | { readonly kind: "CircleNotFound" }
  | { readonly kind: "NotAMember" }
  | { readonly kind: "InvalidName" };

/**
 * Renames a circle. Any active member may do it -- there is no admin/owner
 * role (A4, CM-15), and a solo (1-member) circle is no exception (B4,
 * CM-16).
 */
export async function renameCircle(
  deps: RenameCircleDeps,
  actor: Actor,
  input: RenameCircleInput,
): Promise<Result<Circle, RenameCircleError>> {
  return deps.uow.transaction(async (repos): Promise<Result<Circle, RenameCircleError>> => {
    const circle = await repos.circles.get(input.circleId);
    if (!circle) {
      return err({ kind: "CircleNotFound" });
    }
    if (!findActiveMember(circle, actor.userId)) {
      return err({ kind: "NotAMember" });
    }

    const name = input.name.trim();
    if (name.length === 0) {
      return err({ kind: "InvalidName" });
    }

    const updated: Circle = { ...circle, name, version: circle.version + 1 };
    await repos.circles.save(updated, circle.version);
    return ok(updated);
  });
}
