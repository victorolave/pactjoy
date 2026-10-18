import { type CommitmentId, type MemberId, seasonDay } from "@pactjoy/engine";
import type { Circle, Invite, Member } from "../circle/circle.ts";
import { type CommitmentRecord, commitmentId } from "../commitment/commitment.ts";
import type { Encouragement, NudgeDismissal } from "../encouragement/encouragement.ts";
import type { EntryPhoto } from "../entry-photo/entry-photo.ts";
import type { Habit } from "../habit/habit.ts";
import { AUTO_APPROVE_AFTER_MS, type PauseRequestRecord } from "../pause/pause-request.ts";
import type { FeedReaction } from "../reaction/feed-reaction.ts";
import type { ReviewRecord } from "../review/review.ts";
import type { SeasonClosure } from "../season/closure/season-closure.ts";
import type {
  PactApproval,
  ReviewCadenceWeeks,
  Season,
  SeasonLengthWeeks,
  SeasonStatus,
} from "../season/season.ts";
import {
  type CircleId,
  encouragementId,
  entryPhotoId,
  feedReactionId,
  type HabitId,
  pauseRequestId,
  reviewId,
  type SeasonId,
  seasonClosureId,
  seasonId,
  type UserId,
} from "../shared/ids.ts";
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
  readonly erasedAt?: Instant | null;
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
    erasedAt: options.erasedAt ?? null,
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
  readonly graduatedAt?: Instant | null;
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
    graduatedAt: options.graduatedAt ?? null,
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

/**
 * Builds a pending {@link PauseRequestRecord} for GIVEN-state setup: one
 * Commitment, open end, no responses, `autoApproveAt` exactly 48 h after
 * `requestedAt`. Every field is overridable.
 */
export function pauseRequestFixture(
  overrides: Partial<PauseRequestRecord> = {},
): PauseRequestRecord {
  const requestedAt = overrides.requestedAt ?? DEFAULT_INSTANT;
  return {
    id: pauseRequestId("pause-1"),
    seasonId: seasonId("season-1"),
    memberId: "member-victor" as MemberId,
    reason: "health",
    note: null,
    requestedAt,
    requestedOn: seasonDay(0),
    startDay: seasonDay(0),
    end: { kind: "open" },
    autoApproveAt: instant(requestedAt + AUTO_APPROVE_AFTER_MS),
    status: "pending",
    decidedAt: null,
    decidedOn: null,
    commitments: [{ commitmentId: commitmentId("commitment-1"), resumedOn: null, resumedAt: null }],
    responses: [],
    version: 0,
    ...overrides,
  };
}

/**
 * Builds a completed item-1 interim {@link ReviewRecord} for GIVEN-state setup: period 1, no
 * reflection, no responses. Every field is overridable.
 */
export function reviewFixture(overrides: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: reviewId("review-1"),
    seasonId: seasonId("season-1"),
    memberId: "member-victor" as MemberId,
    periodIndex: 1,
    kind: "interim",
    status: "completed",
    srbai: "item1",
    reflection: { helped: null, hard: null },
    responses: [],
    recordedAt: DEFAULT_INSTANT,
    version: 0,
    ...overrides,
  };
}

/**
 * Builds a {@link SeasonClosure} for GIVEN-state setup: no decisions yet. Every field is overridable.
 */
export function seasonClosureFixture(overrides: Partial<SeasonClosure> = {}): SeasonClosure {
  return {
    id: seasonClosureId("closure-1"),
    seasonId: seasonId("season-1"),
    memberId: "member-victor" as MemberId,
    decisions: [],
    decidedAt: DEFAULT_INSTANT,
    version: 0,
    ...overrides,
  };
}

/**
 * Builds a {@link FeedReaction} for GIVEN-state setup: Victor's heart on a session of the first
 * day. Every field is overridable.
 */
export function feedReactionFixture(overrides: Partial<FeedReaction> = {}): FeedReaction {
  return {
    id: feedReactionId("reaction-1"),
    seasonId: seasonId("season-1"),
    itemKey: "session:commitment-1:1",
    memberId: "member-victor" as MemberId,
    emoji: "heart",
    reactedAt: DEFAULT_INSTANT,
    version: 0,
    ...overrides,
  };
}

/**
 * Builds an {@link Encouragement} for GIVEN-state setup: Victor's raised hands to Andrea for her
 * 3rd week. Every field is overridable.
 */
export function encouragementFixture(overrides: Partial<Encouragement> = {}): Encouragement {
  return {
    id: encouragementId("encouragement-1"),
    seasonId: seasonId("season-1"),
    senderId: "member-victor" as MemberId,
    recipientId: "member-andrea" as MemberId,
    caseWeek: 3,
    emoji: "raisedHands",
    sentAt: DEFAULT_INSTANT,
    sentOn: localDate("2026-10-22"),
    ...overrides,
  };
}

/** Builds a {@link NudgeDismissal} for GIVEN-state setup: Victor hid the nudge about Andrea's 3rd week. */
export function nudgeDismissalFixture(overrides: Partial<NudgeDismissal> = {}): NudgeDismissal {
  return {
    seasonId: seasonId("season-1"),
    viewerId: "member-victor" as MemberId,
    targetId: "member-andrea" as MemberId,
    caseWeek: 3,
    dismissedAt: DEFAULT_INSTANT,
    dismissedOn: localDate("2026-10-22"),
    ...overrides,
  };
}

/**
 * Builds an {@link EntryPhoto} for GIVEN-state setup: a pending reservation of 1 KiB whose
 * attach window is wide open. Every field is overridable.
 */
export function entryPhotoFixture(overrides: Partial<EntryPhoto> = {}): EntryPhoto {
  return {
    id: entryPhotoId("photo-1"),
    seasonId: seasonId("season-1"),
    memberId: "member-victor" as MemberId,
    commitmentId: "commitment-1" as CommitmentId,
    objectKey: "o/00000000000000000000000000000001.jpg",
    byteSize: 1024,
    status: "pending",
    createdAt: DEFAULT_INSTANT,
    attachBy: instant(DEFAULT_INSTANT + 30 * 60_000),
    version: 0,
    ...overrides,
  };
}
