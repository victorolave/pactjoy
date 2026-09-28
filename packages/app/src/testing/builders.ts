import type { MemberId } from "@pactjoy/engine";
import type { Circle, Invite, Member } from "../circle/circle.ts";
import type { CircleId, UserId } from "../shared/ids.ts";
import { type Instant, instant } from "../time/instant.ts";

const DEFAULT_INSTANT: Instant = instant(1_700_000_000_000);

export interface MemberFixtureOptions {
  readonly id: MemberId;
  readonly userId: UserId;
  readonly status?: "active" | "left";
  readonly joinedAt?: Instant;
  readonly leftAt?: Instant | null;
}

/** Builds a {@link Member} for test setup, bypassing use-case validation (unlike `circle.ts`'s `buildCircle`). */
export function memberFixture(options: MemberFixtureOptions): Member {
  return {
    id: options.id,
    userId: options.userId,
    status: options.status ?? "active",
    joinedAt: options.joinedAt ?? DEFAULT_INSTANT,
    leftAt: options.leftAt ?? null,
  };
}

export interface CircleFixtureOptions {
  readonly id: CircleId;
  readonly members: readonly Member[];
  readonly name?: string;
  readonly invite?: Invite | null;
  readonly createdAt?: Instant;
  readonly version?: number;
}

/** Builds a {@link Circle} directly from given members, for GIVEN-state test setup (e.g. an already-full circle). */
export function circleFixture(options: CircleFixtureOptions): Circle {
  return {
    id: options.id,
    name: options.name ?? "Test Circle",
    members: options.members,
    invite: options.invite ?? null,
    createdAt: options.createdAt ?? DEFAULT_INSTANT,
    version: options.version ?? 0,
  };
}
