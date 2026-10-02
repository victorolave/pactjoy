import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Actor } from "../shared/actor.ts";
import type { CircleId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { type Circle, findActiveMember } from "./circle.ts";
import { isDisplayNameTaken, normalizeDisplayName } from "./display-name.ts";

export interface RenameMyDisplayNameDeps {
  readonly uow: UnitOfWork<Repositories>;
}

export interface RenameMyDisplayNameInput {
  readonly circleId: CircleId;
  readonly displayName: string;
}

export type RenameMyDisplayNameError =
  | { readonly kind: "CircleNotFound" }
  | { readonly kind: "CircleArchived" }
  | { readonly kind: "NotAMember" }
  | { readonly kind: "InvalidDisplayName" }
  | { readonly kind: "DisplayNameTaken" };

/**
 * Changes the caller's own display name in a circle (CM-R17). State checks run
 * first, then the name is validated, then uniqueness is checked last, excluding
 * the caller's own current name so a case-only change is allowed.
 *
 * Saves only the circle at `version + 1`: the name is not part of the Pact, so
 * approvals and `pactRevision` are untouched and the season is never read.
 */
export async function renameMyDisplayName(
  deps: RenameMyDisplayNameDeps,
  actor: Actor,
  input: RenameMyDisplayNameInput,
): Promise<Result<Circle, RenameMyDisplayNameError>> {
  return deps.uow.transaction(async (repos): Promise<Result<Circle, RenameMyDisplayNameError>> => {
    const circle = await repos.circles.get(input.circleId);
    if (!circle) {
      return err({ kind: "CircleNotFound" });
    }
    if (circle.archivedAt !== null) {
      return err({ kind: "CircleArchived" });
    }
    const member = findActiveMember(circle, actor.userId);
    if (!member) {
      return err({ kind: "NotAMember" });
    }

    const displayName = normalizeDisplayName(input.displayName);
    if (displayName === null) {
      return err({ kind: "InvalidDisplayName" });
    }
    if (isDisplayNameTaken(circle, displayName, member.id)) {
      return err({ kind: "DisplayNameTaken" });
    }

    const updated: Circle = {
      ...circle,
      members: circle.members.map((m) => (m.id === member.id ? { ...m, displayName } : m)),
      version: circle.version + 1,
    };
    await repos.circles.save(updated, circle.version);
    return ok(updated);
  });
}
