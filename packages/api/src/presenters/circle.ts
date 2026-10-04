import type { Actor, Circle, Invite, MyCircleView, SeasonPhaseName } from "@pactjoy/app";
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

export interface MyCircleDto {
  readonly circle: null | {
    readonly id: string;
    readonly name: string;
    readonly members: readonly {
      readonly id: string;
      readonly displayName: string;
      readonly joinedAt: string;
      readonly isYou: boolean;
    }[];
    readonly invite: InviteDto | null;
  };
  readonly season: null | {
    readonly id: string;
    readonly phase: SeasonPhaseName;
    readonly lengthWeeks: number;
    readonly week: number | null;
    readonly approvalCount: number;
  };
}

/** The Circle tab's read model: active members only, so no status, `leftAt`, version or archive fields. */
export function presentMyCircle(view: MyCircleView): MyCircleDto {
  return {
    circle: view.circle && {
      id: view.circle.id,
      name: view.circle.name,
      members: view.circle.members.map((member) => ({
        id: member.id,
        displayName: member.displayName,
        joinedAt: presentInstant(member.joinedAt),
        isYou: member.isYou,
      })),
      invite: view.circle.invite && {
        code: view.circle.invite.code,
        createdAt: presentInstant(view.circle.invite.createdAt),
        expiresAt: presentInstant(view.circle.invite.expiresAt),
      },
    },
    season: view.season && {
      id: view.season.id,
      phase: view.season.phase,
      lengthWeeks: view.season.lengthWeeks,
      week: view.season.week,
      approvalCount: view.season.approvalCount,
    },
  };
}
