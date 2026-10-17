import { parseDecimal, type SeasonDay, seasonDay } from "@pactjoy/engine";
import { memberId } from "../circle/circle.ts";
import {
  buildCommitment,
  type CommitmentRecord,
  commitmentId,
  type Measure,
} from "../commitment/commitment.ts";
import type { EntryRecord, EntryValue } from "../entry/entry.ts";
import type { Habit } from "../habit/habit.ts";
import type { EffectivePauseRequest } from "../pause/effective-pauses.ts";
import { AUTO_APPROVE_AFTER_MS, type PauseRequestRecord } from "../pause/pause-request.ts";
import type { Season } from "../season/season.ts";
import { circleId, entryId, habitId, pauseRequestId, seasonId, userId } from "../shared/ids.ts";
import { habitFixture, pauseRequestFixture, seasonFixture } from "../testing/builders.ts";
import { fixtureTimeZone, localInstant, SEASON_START } from "../testing/entry-fixtures.ts";
import { PER_DAY_REACH, TIMES_PER_WEEK, WEEKLY_TOTAL } from "../testing/entry-measures.ts";
import { type Instant, instant } from "../time/instant.ts";
import type { LocalDate } from "../time/local-date.ts";
import { localDateOfSeasonDay } from "../time/season-calendar.ts";
import type { FeedWorld } from "./derive-feed.ts";

/** Test setup shared by the feed suites: Andrea and Victor in a 4-week season that starts on {@link SEASON_START}. */
export const ANDREA = memberId("member-andrea");
export const VICTOR = memberId("member-victor");
export const MEDITAR = commitmentId("commitment-meditar");
export const LEER = commitmentId("commitment-leer");
export const CORRER = commitmentId("commitment-correr");
export const SEASON_ID = seasonId("season-1");

/** Andrea's "Meditar": every day (a session per day), 60 %. Visible unless a test says otherwise. */
export function meditar(
  overrides: Partial<CommitmentRecord> & { readonly measure?: Measure } = {},
): CommitmentRecord {
  return buildCommitment({
    id: MEDITAR,
    memberId: ANDREA,
    habitId: habitId("habit-meditar"),
    weightPercent: 60,
    privacy: "visible",
    measure: PER_DAY_REACH,
    ...overrides,
  });
}

/** Andrea's "Leer": one weekly total, 40 %. */
export function leer(overrides: Partial<CommitmentRecord> = {}): CommitmentRecord {
  return buildCommitment({
    id: LEER,
    memberId: ANDREA,
    habitId: habitId("habit-leer"),
    weightPercent: 40,
    privacy: "visible",
    measure: WEEKLY_TOTAL,
    ...overrides,
  });
}

/** Victor's "Correr": three sessions a week on any day, 100 %. */
export function correr(overrides: Partial<CommitmentRecord> = {}): CommitmentRecord {
  return buildCommitment({
    id: CORRER,
    memberId: VICTOR,
    habitId: habitId("habit-correr"),
    weightPercent: 100,
    privacy: "visible",
    measure: TIMES_PER_WEEK,
    ...overrides,
  });
}

export const HABITS: readonly Habit[] = [
  habitFixture({ id: habitId("habit-meditar"), ownerId: userId("user-andrea"), name: "Meditar" }),
  habitFixture({ id: habitId("habit-leer"), ownerId: userId("user-andrea"), name: "Leer" }),
  habitFixture({ id: habitId("habit-correr"), ownerId: userId("user-victor"), name: "Correr" }),
];

/** The civil date of 0-BASED season day `day`. */
export function dateOf(day: number): LocalDate {
  return localDateOfSeasonDay(seasonDay(day), SEASON_START);
}

/** A live entry for 0-based season day `day`, recorded at noon of that day (or `recordedAt`). */
export function entryFor(
  commitment: CommitmentRecord,
  day: number,
  value: EntryValue = { kind: "done" },
  extra: { readonly recordedAt?: Instant; readonly id?: string } = {},
): EntryRecord {
  // Two entries on the same day need an explicit id of their own.
  const id = extra.id ?? `entry-${commitment.id}-${day}`;
  return {
    id: entryId(id),
    seasonId: SEASON_ID,
    memberId: commitment.memberId,
    commitmentId: commitment.id,
    day: seasonDay(day),
    recordedOn: seasonDay(day),
    recordedAt: extra.recordedAt ?? localInstant(dateOf(day)),
    clientRequestId: id,
    editedAt: null,
    version: 0,
    requestFingerprint: "",
    value,
    note: null,
    photoId: null,
    deleted: false,
  };
}

/** `minutes` minutes logged for the day. */
export function minutes(
  commitment: CommitmentRecord,
  day: number,
  amount: string,
  extra: { readonly recordedAt?: Instant; readonly id?: string } = {},
): EntryRecord {
  return entryFor(commitment, day, { kind: "quantity", value: parseDecimal(amount) }, extra);
}

export function missed(commitment: CommitmentRecord, day: number): EntryRecord {
  return entryFor(commitment, day, { kind: "missed" });
}

/** An effective, approved request from `startDay` (0-based), decided at `decidedAt` on `decidedOn`. */
export function approvedPause(
  overrides: Partial<PauseRequestRecord> & {
    readonly decidedAt?: Instant;
    readonly decidedOn?: SeasonDay;
  } = {},
): EffectivePauseRequest {
  const decidedAt = overrides.decidedAt ?? instant(localInstant(dateOf(2)));
  const decidedOn = overrides.decidedOn ?? seasonDay(2);
  const record = pauseRequestFixture({
    id: pauseRequestId("pause-1"),
    seasonId: SEASON_ID,
    memberId: ANDREA,
    requestedAt: decidedAt,
    requestedOn: decidedOn,
    startDay: decidedOn,
    autoApproveAt: instant(decidedAt + AUTO_APPROVE_AFTER_MS),
    status: "approved",
    decidedAt,
    decidedOn,
    commitments: [{ commitmentId: MEDITAR, resumedOn: null, resumedAt: null }],
    ...overrides,
  });
  return { record, decision: { status: "approved", decidedAt, decidedOn } };
}

export interface FeedWorldOptions {
  readonly commitments?: readonly CommitmentRecord[];
  readonly entries?: readonly EntryRecord[];
  readonly requests?: readonly EffectivePauseRequest[];
  readonly habits?: readonly Habit[];
  /** 0-based "today" of the engine. */
  readonly today?: number;
  readonly lengthWeeks?: Season["lengthWeeks"];
  readonly status?: Season["status"];
}

/** A pure world for `deriveFeed`: no repositories, nothing to await. */
export function feedWorld(options: FeedWorldOptions = {}): FeedWorld {
  const season = seasonFixture({
    id: SEASON_ID,
    circleId: circleId("circle-1"),
    status: options.status ?? "active",
    nominalStart: SEASON_START,
    actualStart: SEASON_START,
    lengthWeeks: options.lengthWeeks ?? 4,
    commitments: options.commitments ?? [meditar(), leer(), correr()],
  });
  return {
    season,
    actualStart: SEASON_START,
    today: seasonDay(options.today ?? 27),
    entries: options.entries ?? [],
    requests: options.requests ?? [],
    habits: options.habits ?? HABITS,
    timeZone: fixtureTimeZone,
  };
}
