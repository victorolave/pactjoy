import type { Repositories } from "../ports/repositories.ts";
import type { Actor } from "../shared/actor.ts";
import { ok, type Result } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import type { Instant } from "../time/instant.ts";
import { activeMembers } from "./circle.ts";
import { checkJoinable, type JoinableError } from "./join-circle.ts";

export interface PreviewInviteDeps {
  readonly uow: { read<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> };
  readonly clock: Clock;
}

export interface InvitePreview {
  readonly circleName: string;
  /** The inviter's display name while they are still active; `null` once they left (no member ids). */
  readonly invitedBy: string | null;
  readonly activeMemberCount: number;
  readonly expiresAt: Instant;
}

export type PreviewInviteError = JoinableError;

/**
 * What a join with this code would join, without joining: same guard, same errors and same order
 * as `joinCircle` (they share `checkJoinable`). Read-only; the display-name checks are not part
 * of it because the preview takes no name.
 */
export async function previewInvite(
  deps: PreviewInviteDeps,
  actor: Actor,
  input: { readonly inviteCode: string },
): Promise<Result<InvitePreview, PreviewInviteError>> {
  return deps.uow.read(async (repos) => {
    const joinable = await checkJoinable(repos, input.inviteCode, actor, deps.clock.now());
    if (!joinable.ok) {
      return joinable;
    }
    const { circle, invite } = joinable.value;
    const members = activeMembers(circle);
    const inviter = members.find((member) => member.id === invite.createdBy);
    return ok({
      circleName: circle.name,
      invitedBy: inviter?.displayName ?? null,
      activeMemberCount: members.length,
      expiresAt: invite.expiresAt,
    });
  });
}
