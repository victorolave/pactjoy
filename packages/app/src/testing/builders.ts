import type { MemberId } from "@pactjoy/engine";
import type { Circle, Invite, Member } from "../circle/circle.ts";
import type { CommitmentRecord } from "../commitment/commitment.ts";
import type { Habit } from "../habit/habit.ts";
import type {
  PactApproval,
  ReviewCadenceWeeks,
  Season,
  SeasonLengthWeeks,
  SeasonStatus,
} from "../season/season.ts";
import type { CircleId, HabitId, SeasonId, UserId } from "../shared/ids.ts";
import { type Instant, instant } from "../time/instant.ts";
import type { LocalDate } from "../time/local-date.ts";
import { localDate } from "../time/local-date.ts";
import type { TimeZoneId } from "../time/time-zone.port.ts";
import { timeZoneId } from "../time/time-zone.port.ts";

const DEFAULT_INSTANT: Instant = instant(1_700_000_000_000);

export interface MemberFixtureOptions {
  readonly id: MemberId;
  readonly userId: UserId;
  readonly displayName?: string;
  readonly status?: "active" | "left";
  readonly joinedAt?: Instant;
  readonly leftAt?: Instant | null;
}

/** Builds a {@link Member} for test setup, bypassing use-case validation (unlike `circle.ts`'s `buildCircle`). */
export function memberFixture(options: MemberFixtureOptions): Member {
  return {
    id: options.id,
    userId: options.userId,
    displayName: options.displayName ?? `Member ${options.id.slice(-12)}`,
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
  readonly archivedAt?: Instant | null;
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
    archivedAt: options.archivedAt ?? null,
    version: options.version ?? 0,
  };
}

export interface HabitFixtureOptions {
  readonly id: HabitId;
  readonly ownerId: UserId;
  readonly name?: string;
  readonly why?: string | null;
  readonly category?: string | null;
  readonly icon?: string | null;
  readonly createdAt?: Instant;
  readonly version?: number;
}

/** Builds a {@link Habit} for GIVEN-state test setup, bypassing use-case validation (unlike `habit.ts`'s `buildHabit`). */
export function habitFixture(options: HabitFixtureOptions): Habit {
  return {
    id: options.id,
    ownerId: options.ownerId,
    name: options.name ?? "Test Habit",
    why: options.why ?? null,
    category: options.category ?? null,
    icon: options.icon ?? null,
    createdAt: options.createdAt ?? DEFAULT_INSTANT,
    version: options.version ?? 0,
  };
}

const DEFAULT_TIME_ZONE: TimeZoneId = timeZoneId("America/Santiago");
const DEFAULT_NOMINAL_START: LocalDate = localDate("2026-10-01");

export interface SeasonFixtureOptions {
  readonly id: SeasonId;
  readonly circleId: CircleId;
  readonly timeZone?: TimeZoneId;
  readonly nominalStart?: LocalDate;
  readonly actualStart?: LocalDate | null;
  readonly lengthWeeks?: SeasonLengthWeeks;
  readonly reviewCadenceWeeks?: ReviewCadenceWeeks;
  readonly status?: SeasonStatus;
  readonly commitments?: readonly CommitmentRecord[];
  readonly approvals?: readonly PactApproval[];
  readonly pactClosedAt?: Instant | null;
  readonly pactRevision?: number;
  readonly createdAt?: Instant;
  readonly version?: number;
}

/**
 * Builds a {@link Season} directly for GIVEN-state test setup (e.g.
 * `join-circle.test.ts` controlling the join gate via a real `Season`
 * row, B11).
 */
export function seasonFixture(options: SeasonFixtureOptions): Season {
  return {
    id: options.id,
    circleId: options.circleId,
    timeZone: options.timeZone ?? DEFAULT_TIME_ZONE,
    nominalStart: options.nominalStart ?? DEFAULT_NOMINAL_START,
    actualStart: options.actualStart ?? null,
    lengthWeeks: options.lengthWeeks ?? 8,
    reviewCadenceWeeks: options.reviewCadenceWeeks ?? 2,
    status: options.status ?? "pactOpen",
    commitments: options.commitments ?? [],
    approvals: options.approvals ?? [],
    pactClosedAt: options.pactClosedAt ?? null,
    pactRevision: options.pactRevision ?? 0,
    createdAt: options.createdAt ?? DEFAULT_INSTANT,
    version: options.version ?? 0,
  };
}
