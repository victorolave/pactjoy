import type { UserId } from "../shared/ids.ts";
import type { Instant } from "../time/instant.ts";
import type { Member } from "./circle.ts";

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
