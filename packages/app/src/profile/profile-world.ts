import { fromInt, type MemberId, seasonDay } from "@pactjoy/engine";
import { type Circle, memberId } from "../circle/circle.ts";
import { buildCommitment, type CommitmentRecord, commitmentId } from "../commitment/commitment.ts";
import type { EntryRecord } from "../entry/entry.ts";
import type { ReviewKind, ReviewRecord } from "../review/review.ts";
import { seedReview } from "../review/review-seed.ts";
import type { ReviewCadenceWeeks, Season, SeasonLengthWeeks } from "../season/season.ts";
import type { Actor } from "../shared/actor.ts";
import {
  circleId,
  type EntryId,
  habitId,
  reviewId,
  type SeasonId,
  seasonId,
  userId,
} from "../shared/ids.ts";
import { createTestApp, type TestApp } from "../testing/app-harness.ts";
import {
  circleFixture,
  habitFixture,
  memberFixture,
  reviewFixture,
  seasonFixture,
} from "../testing/builders.ts";
import { atInstant, fixtureTimeZone, localInstant } from "../testing/entry-fixtures.ts";
import { PER_DAY_REACH, WEEKLY_TOTAL } from "../testing/entry-measures.ts";
import { instant } from "../time/instant.ts";
import { epochDay, type LocalDate, localDate, localDateOfEpochDay } from "../time/local-date.ts";
import type { TimeZone, TimeZoneId } from "../time/time-zone.port.ts";

/**
 * Test world for the Perfil read model (`profileSummary`): a circle of Andrea and Victor, three
 * habits of Andrea (and one of Victor), and seasons written straight to the stores (so a closed
 * season from last year needs no use-case choreography). Andrea is the viewer.
 */
export type Who = "andrea" | "victor";

export const DAILY = PER_DAY_REACH;
export const WEEKLY = WEEKLY_TOTAL;

/** Habit ids; Andrea owns the first four, Victor the last. `createdAt` ascends in this order. */
export const HABITS = {
  meditar: habitId("habit-meditar"),
  leer: habitId("habit-leer"),
  yoga: habitId("habit-yoga"),
  extra: habitId("habit-extra"),
  correr: habitId("habit-correr"),
} as const;
export type HabitKey = keyof typeof HABITS;

export interface CommitmentSpec {
  readonly id: string;
  readonly who?: Who;
  readonly habit: HabitKey;
  readonly weight?: number;
  readonly measure?: CommitmentRecord["measure"];
  readonly privacy?: "visible" | "private";
}

export interface SeasonSpec {
  readonly id: string;
  /** Day 1 of the season; `null` for a season whose pact is still open. */
  readonly start: LocalDate | null;
  readonly status: Season["status"];
  readonly lengthWeeks?: SeasonLengthWeeks;
  readonly cadence?: ReviewCadenceWeeks;
  readonly circle?: string;
  readonly timeZone?: TimeZoneId;
  readonly commitments: readonly CommitmentSpec[];
}

export interface ProfileWorldOptions {
  /** Andrea belongs to no circle (her habits still exist). */
  readonly noCircle?: boolean;
  /** A second circle Andrea LEFT (`circle-0`), for seasons that must be ignored. */
  readonly leftCircle?: boolean;
  readonly timeZone?: TimeZone;
  readonly graduated?: readonly HabitKey[];
}

export interface ProfileWorld {
  readonly app: TestApp;
  readonly andrea: Actor;
  readonly victor: Actor;
  /** A copy of the app whose clock reads noon (UTC-3) on `date`. */
  at(date: LocalDate): TestApp;
}

export const plusDays = (date: LocalDate, days: number): LocalDate =>
  localDateOfEpochDay(epochDay(date) + days);

const ANDREA = userId("user-andrea");
const VICTOR = userId("user-victor");
const MEMBER: Record<Who, MemberId> = {
  andrea: memberId("member-andrea"),
  victor: memberId("member-victor"),
};

export async function givenProfileWorld(options: ProfileWorldOptions = {}): Promise<ProfileWorld> {
  const app = createTestApp({
    now: localInstant(localDate("2026-10-01")),
    timeZone: options.timeZone ?? fixtureTimeZone,
  });
  const andreaMember = memberFixture({
    id: MEMBER.andrea,
    userId: ANDREA,
    displayName: "Andrea",
  });
  const victorMember = memberFixture({ id: MEMBER.victor, userId: VICTOR, displayName: "Victor" });
  const circles: Circle[] = [];
  if (!options.noCircle) {
    circles.push(
      circleFixture({ id: circleId("circle-1"), members: [andreaMember, victorMember] }),
    );
  }
  if (options.leftCircle) {
    circles.push(
      circleFixture({
        id: circleId("circle-0"),
        members: [
          { ...andreaMember, status: "left", leftAt: instant(5) },
          memberFixture({ id: memberId("member-zoe"), userId: userId("user-zoe") }),
        ],
      }),
    );
  }
  const graduated = new Set(options.graduated ?? []);
  await app.uow.transaction(async (repos) => {
    for (const circle of circles) await repos.circles.save(circle, null);
    let created = 1;
    for (const key of Object.keys(HABITS) as HabitKey[]) {
      await repos.habits.save(
        habitFixture({
          id: HABITS[key],
          ownerId: key === "correr" ? VICTOR : ANDREA,
          name: key,
          icon: "book",
          createdAt: instant(created++ * 1000),
          graduatedAt: graduated.has(key) ? instant(9_000) : null,
        }),
        null,
      );
    }
    return { ok: true, value: undefined };
  });
  return {
    app,
    andrea: { userId: ANDREA },
    victor: { userId: VICTOR },
    at: (date) => atInstant(app, localInstant(date)),
  };
}

/** Stores a season (oldest first: `listByCircle` is newest first by insertion order). */
export async function givenSeason(world: ProfileWorld, spec: SeasonSpec): Promise<SeasonId> {
  const commitments = spec.commitments.map((c) =>
    buildCommitment({
      id: commitmentId(c.id),
      memberId: MEMBER[c.who ?? "andrea"],
      habitId: HABITS[c.habit],
      weightPercent: c.weight ?? 100,
      privacy: c.privacy ?? "visible",
      measure: c.measure ?? DAILY,
    }),
  );
  const season = seasonFixture({
    id: seasonId(spec.id),
    circleId: circleId(spec.circle ?? "circle-1"),
    status: spec.status,
    nominalStart: spec.start ?? localDate("2026-10-01"),
    actualStart: spec.start,
    ...(spec.timeZone ? { timeZone: spec.timeZone } : {}),
    lengthWeeks: spec.lengthWeeks ?? 4,
    reviewCadenceWeeks: spec.cadence ?? 2,
    pactClosedAt: spec.status === "pactOpen" ? null : instant(1),
    commitments,
  });
  await world.app.uow.transaction(async (repos) => {
    await repos.seasons.save(season, null);
    return { ok: true, value: undefined };
  });
  return season.id;
}

let entrySeq = 0;

/** Logs `minutes` (or a done) for a commitment on each 0-based season day of `days`. */
export async function logDays(
  world: ProfileWorld,
  season: string,
  commitment: string,
  days: Iterable<number>,
  options: { who?: Who; minutes?: number } = {},
): Promise<void> {
  await world.app.uow.transaction(async (repos) => {
    for (const day of days) {
      entrySeq += 1;
      const record: EntryRecord = {
        id: `entry-${entrySeq}` as EntryId,
        seasonId: seasonId(season),
        memberId: MEMBER[options.who ?? "andrea"],
        commitmentId: commitmentId(commitment),
        day: seasonDay(day),
        recordedOn: seasonDay(day),
        recordedAt: instant(entrySeq),
        clientRequestId: `req-${entrySeq}`,
        editedAt: null,
        version: 0,
        requestFingerprint: `fp-${entrySeq}`,
        value: { kind: "quantity", value: fromInt(options.minutes ?? 30) },
        note: null,
        photoId: null,
        deleted: false,
      };
      await repos.entries.add(record);
    }
    return { ok: true, value: undefined };
  });
}

export const range = (from: number, to: number): readonly number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

let reviewSeq = 0;

/** Stores a review of `who` for `season`, answering each of `commitments` with `score` on all items. */
export async function givenReview(
  world: ProfileWorld,
  season: string,
  commitments: readonly string[],
  options: {
    kind: ReviewKind;
    periodIndex: number;
    score?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
    status?: ReviewRecord["status"];
    who?: Who;
  },
): Promise<void> {
  reviewSeq += 1;
  const score = options.score ?? 5;
  const skipped = options.status === "skipped";
  const record = reviewFixture({
    id: reviewId(`review-${reviewSeq}`),
    seasonId: seasonId(season),
    memberId: MEMBER[options.who ?? "andrea"],
    periodIndex: options.periodIndex,
    kind: options.kind,
    status: options.status ?? "completed",
    srbai: skipped ? null : "full",
    responses: skipped
      ? []
      : commitments.map((id) => ({
          commitmentId: commitmentId(id),
          items: [score, score, score, score] as const,
        })),
  });
  await seedReview(world.app, record);
}
