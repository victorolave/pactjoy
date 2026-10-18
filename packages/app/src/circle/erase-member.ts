import type { MemberId } from "@pactjoy/engine";
import type { UserId } from "../shared/ids.ts";
import type { Instant } from "../time/instant.ts";
import type { Circle, Member } from "./circle.ts";

/**
 * Pure: the circle without its invite when one of the erased members created it (owner decision:
 * invites created by the erased are deleted, not kept). The invite is part of the Circle aggregate, so
 * the caller persists this with the tombstone's own version-checked `circles.save`, which deletes the
 * row and frees the code; no repository method is needed. Any other invite, or none, is left alone.
 */
export function eraseInviteOf(circle: Circle, memberIds: readonly MemberId[]): Circle {
  if (!circle.invite || !memberIds.includes(circle.invite.createdBy)) return circle;
  return { ...circle, invite: null };
}

/** Empty is reserved: real names cannot be empty. Peer presenters label it generically. */
export const ERASED_DISPLAY_NAME = "";

/** Pure tombstone. The caller must settle normal leave effects in the same transaction first. */
export function eraseMember(member: Member, now: Instant, rotatedUserId: UserId): Member {
  return {
    ...member,
    userId: rotatedUserId,
    displayName: ERASED_DISPLAY_NAME,
    status: "left",
    leftAt: member.leftAt ?? now,
    erasedAt: now,
  };
}
