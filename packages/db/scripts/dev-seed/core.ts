/**
 * Clock-driven seeding through the REAL use cases (no SQL): a scenario sets the fake clock to a
 * past local day, runs `createCircle`, `createSeason`, `approvePact`, `recordEntry`… exactly as
 * the API would at that moment, then moves the clock forward. Every rule (start-date window,
 * grace, R1 counting, privacy) is enforced by the use cases themselves.
 */

import type {
  Actor,
  Clock,
  EntryValueInput,
  IdGenerator,
  Instant,
  MeasureInput,
  RandomSource,
  Repositories,
  SeasonId,
  SeasonLengthWeeks,
  TimeZone,
  UnitOfWork,
} from "@pactjoy/app";
import {
  addCommitment,
  approvePact,
  createCircle,
  createHabit,
  createSeason,
  generateInvite,
  instant,
  joinCircle,
  leaveCircle,
  listMyHabits,
  localDate,
  myCircle,
  recordEntry,
  timeZoneId,
} from "@pactjoy/app";
import type { CommitmentId } from "@pactjoy/engine";

const DAY_MS = 86_400_000;

/** The ports every use case needs, with a clock the seed moves. */
export interface SeedApp {
  readonly uow: UnitOfWork<Repositories>;
  readonly clock: Clock;
  readonly timeZone: TimeZone;
  readonly ids: IdGenerator;
  readonly random: RandomSource;
}

export interface SeedContext {
  readonly app: SeedApp;
  /** The season time zone (IANA), as the creator's device would send it. */
  readonly zone: string;
  /** Moves the fake clock to local noon of `date` in `zone`. */
  readonly setDate: (date: string) => void;
  readonly log: (message: string) => void;
}

/** A clock that only moves when the seed says so. */
export function createSeedClock(start: Instant): Clock & { set(at: Instant): void } {
  let now = start;
  return {
    now: () => now,
    set(at) {
      now = at;
    },
  };
}

/** Local noon of `date` in `zone`: the instant whose local date in that zone is `date`. */
export function noonIn(date: string, zone: string, timeZone: TimeZone): Instant {
  const utcNoon = Date.parse(`${date}T12:00:00Z`);
  for (const shift of [0, -12, 12, -6, 6]) {
    const candidate = instant(utcNoon + shift * 3_600_000);
    if (timeZone.localDateAt(candidate, timeZoneId(zone)) === date) {
      return candidate;
    }
  }
  throw new Error(`no local noon for ${date} in ${zone}`);
}

export const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Engine weekday of a calendar date: 0 = Monday … 6 = Sunday. */
export const weekdayOf = (date: string): number =>
  (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;

type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly kind: string } };

/** A failed use case aborts the seed with its error kind (the seed must never half-succeed). */
export function must<T>(result: Outcome<T>, what: string): T {
  if (!result.ok) throw new Error(`${what}: ${result.error.kind}`);
  return result.value;
}

/** Resets ONE seeded account: it leaves its current circle (use case, nothing deleted). */
export async function leaveCurrentCircle(ctx: SeedContext, actor: Actor): Promise<void> {
  const view = await myCircle(ctx.app, actor);
  if (view.circle === null) return;
  must(await leaveCircle(ctx.app, actor, { circleId: view.circle.id }), "leaveCircle");
}

/** Reuses the account's habit with that name, so reruns do not pile up duplicates in Perfil. */
async function habitFor(ctx: SeedContext, actor: Actor, name: string, icon: string | null) {
  const existing = (await listMyHabits(ctx.app, actor)).find((habit) => habit.name === name);
  return existing ?? must(await createHabit(ctx.app, actor, { name, icon }), `createHabit ${name}`);
}

export interface CommitmentSpec {
  /** Scenario-local key used to log entries against it. */
  readonly key: string;
  readonly habit: string;
  readonly icon: string | null;
  readonly weightPercent: number;
  readonly privacy?: "visible" | "private";
  readonly measure: MeasureInput;
}

export interface SeasonMember {
  readonly actor: Actor;
  readonly displayName: string;
  readonly commitments: readonly CommitmentSpec[];
}

export interface SeededSeason {
  readonly seasonId: SeasonId;
  readonly commitments: ReadonlyMap<string, { readonly actor: Actor; readonly id: CommitmentId }>;
  readonly pactRevision: number;
}

/**
 * One circle (first member creates, the rest join with its invite) and a season whose pact is
 * filled on `createdOn`. `approvals` lists who approves (all by default); with everyone, the
 * pact closes and the season starts on `startDate`.
 */
export async function seedSeason(ctx: SeasonContextInput): Promise<SeededSeason> {
  const { seed, circleName, members, createdOn, startDate, lengthWeeks } = ctx;
  seed.setDate(createdOn);
  const [owner, ...others] = members;
  if (owner === undefined) throw new Error("a season needs at least one member");
  const circle = must(
    await createCircle(seed.app, owner.actor, { name: circleName, displayName: owner.displayName }),
    "createCircle",
  );
  for (const member of others) {
    const invite = must(
      await generateInvite(seed.app, owner.actor, { circleId: circle.id }),
      "generateInvite",
    );
    must(
      await joinCircle(seed.app, member.actor, {
        inviteCode: invite.code,
        displayName: member.displayName,
      }),
      "joinCircle",
    );
  }
  const created = must(
    await createSeason(seed.app, owner.actor, {
      circleId: circle.id,
      timezone: seed.zone,
      startDate,
      lengthWeeks,
    }),
    "createSeason",
  );
  let season = created.season;
  const commitments = new Map<string, { actor: Actor; id: CommitmentId }>();
  for (const member of members) {
    for (const spec of member.commitments) {
      const habit = await habitFor(seed, member.actor, spec.habit, spec.icon);
      const added = must(
        await addCommitment(seed.app, member.actor, {
          seasonId: season.id,
          habitId: habit.id,
          weightPercent: spec.weightPercent,
          privacy: spec.privacy ?? "visible",
          measure: spec.measure,
        }),
        `addCommitment ${spec.key}`,
      );
      season = added.season;
      const record = season.commitments.find(
        (c) => c.habitId === habit.id && c.memberId === added.viewerId,
      );
      if (!record) throw new Error(`commitment ${spec.key} not found after adding it`);
      commitments.set(spec.key, { actor: member.actor, id: record.id });
    }
  }
  for (const member of ctx.approvals ?? members) {
    const approved = must(
      await approvePact(seed.app, member.actor, {
        seasonId: season.id,
        expectedPactRevision: season.pactRevision,
      }),
      "approvePact",
    );
    season = approved.season;
  }
  return { seasonId: season.id, commitments, pactRevision: season.pactRevision };
}

export interface SeasonContextInput {
  readonly seed: SeedContext;
  readonly circleName: string;
  readonly members: readonly SeasonMember[];
  /** Local day the circle and season are created and the pact is filled. */
  readonly createdOn: string;
  readonly startDate: string;
  readonly lengthWeeks: SeasonLengthWeeks;
  /** Members who approve; omitted = everyone (the pact closes). */
  readonly approvals?: readonly SeasonMember[];
}

/** One registro to make: for `day`, recorded `lateBy` days later (default the same day). */
export interface PlannedEntry {
  readonly day: string;
  readonly key: string;
  readonly value: EntryValueInput;
  readonly note?: string;
  readonly lateBy?: number;
}

/** Records every planned entry in recording order, moving the clock day by day. */
export async function recordPlan(
  seed: SeedContext,
  season: SeededSeason,
  plan: readonly PlannedEntry[],
): Promise<void> {
  const byRecordedDay = [...plan].sort((a, b) =>
    addDays(a.day, a.lateBy ?? 0).localeCompare(addDays(b.day, b.lateBy ?? 0)),
  );
  for (const [index, entry] of byRecordedDay.entries()) {
    const target = season.commitments.get(entry.key);
    if (!target) throw new Error(`unknown commitment key ${entry.key}`);
    seed.setDate(addDays(entry.day, entry.lateBy ?? 0));
    must(
      await recordEntry(seed.app, target.actor, {
        seasonId: season.seasonId,
        commitmentId: target.id,
        forDate: localDate(entry.day),
        value: entry.value,
        note: entry.note ?? null,
        clientRequestId: `seed-${entry.key}-${entry.day}-${index}`,
      }),
      `recordEntry ${entry.key} ${entry.day}`,
    );
  }
}
