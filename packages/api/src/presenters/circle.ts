import type { Actor, Circle, Invite } from "@pactjoy/app";
import { presentInstant, presentInstantOrNull } from "./time.ts";

export interface InviteDto {
  readonly code: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface CircleDto {
  readonly id: string;
  readonly name: string;
  readonly members: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly status: "active" | "left";
    readonly joinedAt: string;
    readonly leftAt: string | null;
    readonly isYou: boolean;
  }[];
  readonly invite: InviteDto | null;
  readonly createdAt: string;
  readonly archivedAt: string | null;
  readonly version: number;
}

export function presentInvite(invite: Invite): InviteDto {
  return {
    code: invite.code,
    createdAt: presentInstant(invite.createdAt),
    expiresAt: presentInstant(invite.expiresAt),
  };
}

/** `userId` is never emitted; `isYou` lets the client learn its own MemberId. The invite is shown to active members only. */
export function presentCircle(circle: Circle, viewer: Actor): CircleDto {
  const viewerIsActive = circle.members.some(
    (member) => member.userId === viewer.userId && member.status === "active",
  );
  return {
    id: circle.id,
    name: circle.name,
    members: circle.members.map((member) => ({
      id: member.id,
      displayName: member.displayName,
      status: member.status,
      joinedAt: presentInstant(member.joinedAt),
      leftAt: presentInstantOrNull(member.leftAt),
      isYou: member.userId === viewer.userId,
    })),
    invite: viewerIsActive && circle.invite !== null ? presentInvite(circle.invite) : null,
    createdAt: presentInstant(circle.createdAt),
    archivedAt: presentInstantOrNull(circle.archivedAt),
    version: circle.version,
  };
}
