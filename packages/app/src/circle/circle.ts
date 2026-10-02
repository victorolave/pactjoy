import type { MemberId } from "@pactjoy/engine";
import type { CircleId, UserId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { isStorableText } from "../shared/storable-text.ts";
import type { Instant } from "../time/instant.ts";
import { normalizeDisplayName } from "./display-name.ts";
import type { InviteCode } from "./invite-code.ts";

/**
 * A person's membership in a {@link Circle} (Miembro). All members are
 * equal -- no admin role exists (A4). `id` is a `MemberId` from
 * `@pactjoy/engine` (it has no exported validating constructor there, see
 * {@link memberId}).
 */
export interface Member {
  readonly id: MemberId;
  readonly userId: UserId;
  /** Chosen per circle (DN-R1), stored trimmed; unique among active members (DN-R3). */
  readonly displayName: string;
  readonly status: "active" | "left";
  readonly joinedAt: Instant;
  readonly leftAt: Instant | null;
}

/**
 * The circle's current invite (Notion, A1). A circle holds at most one at a
 * time -- regenerating (CM-5) replaces it outright, which is what makes the
 * previous code stop resolving.
 */
export interface Invite {
  readonly code: InviteCode;
  readonly createdAt: Instant;
  readonly expiresAt: Instant;
  readonly createdBy: MemberId;
}

/** A group of 1-6 people sharing a season (Círculo, B4 -- solo circles allowed). */
export interface Circle {
  readonly id: CircleId;
  readonly name: string;
  readonly members: readonly Member[];
  readonly invite: Invite | null;
  readonly createdAt: Instant;
  /**
   * Set when the last active member leaves (2026-09-30 decision). Archiving
   * is TERMINAL: an archived circle keeps its history readable but accepts
   * no join, invite, rename or new season. Invariant: a circle with
   * `archivedAt === null` always has at least one active member, and only
   * `leaveCircle` archives (see `CircleRepository`).
   */
  readonly archivedAt: Instant | null;
  readonly version: number;
}

export const MAX_MEMBERS = 6;

export type BuildCircleError =
  | { readonly kind: "InvalidName" }
  | { readonly kind: "InvalidDisplayName" };

/**
 * `MemberId`'s brand has no exported constructor in `@pactjoy/engine`
 * (unlike `SeasonDay`'s `seasonDay()`) -- it's a structural brand only, no
 * runtime invariant to check, so a single-step cast is the whole
 * implementation. Centralized here so every place that mints a `MemberId`
 * (production `IdGenerator.next()` results, test fixtures) goes through one
 * function.
 */
export function memberId(value: string): MemberId {
  return value as MemberId;
}

export interface BuildCircleInput {
  readonly id: CircleId;
  readonly name: string;
  readonly creatorId: MemberId;
  readonly creatorUserId: UserId;
  readonly creatorDisplayName: string;
  readonly now: Instant;
}

/**
 * Pure constructor for a brand-new {@link Circle} (CM-1, CM-2): the creator
 * becomes its sole, active first member. `create-circle.ts` is the only
 * production caller -- it supplies ids/clock via ports, this function only
 * validates and assembles.
 */
export function buildCircle(input: BuildCircleInput): Result<Circle, BuildCircleError> {
  const name = input.name.trim();
  if (name.length === 0 || !isStorableText(name)) {
    return err({ kind: "InvalidName" });
  }
  const creatorDisplayName = normalizeDisplayName(input.creatorDisplayName);
  if (creatorDisplayName === null) {
    return err({ kind: "InvalidDisplayName" });
  }

  return ok({
    id: input.id,
    name,
    members: [
      {
        id: input.creatorId,
        userId: input.creatorUserId,
        displayName: creatorDisplayName,
        status: "active",
        joinedAt: input.now,
        leftAt: null,
      },
    ],
    invite: null,
    createdAt: input.now,
    archivedAt: null,
    version: 0,
  });
}

/** Members who have not left the circle (A3/B9: a left member keeps their history but drops out). */
export function activeMembers(circle: Circle): readonly Member[] {
  return circle.members.filter((member) => member.status === "active");
}

/** The active member for `userId`, if any (used by every use case that requires "any member may..."). */
export function findActiveMember(circle: Circle, userId: UserId): Member | undefined {
  return activeMembers(circle).find((member) => member.userId === userId);
}
