import {
  type Fraction,
  frac,
  fromInt,
  gt,
  type MemberId,
  progressAtValue,
  type SeasonDay,
  seasonDay,
} from "@pactjoy/engine";
import type { CommitmentRecord } from "../commitment/commitment.ts";
import { commitmentToEngine } from "../commitment/to-engine.ts";
import type { EntryRecord } from "../entry/entry.ts";
import { isPaused } from "../entry/on-hold.ts";
import type { Habit } from "../habit/habit.ts";
import type { EffectivePauseRequest } from "../pause/effective-pauses.ts";
import type { PauseRequestRecord } from "../pause/pause-request.ts";
import { toEnginePauses } from "../pause/to-engine.ts";
import { closeDatesOf } from "../season/closure/season-calendar.ts";
import type { SeasonGraduation } from "../season/closure/season-graduations.ts";
import type { Season } from "../season/season.ts";
import type { HabitId } from "../shared/ids.ts";
import type { Instant } from "../time/instant.ts";
import type { LocalDate } from "../time/local-date.ts";
import { localDateOfSeasonDay } from "../time/season-calendar.ts";
import type { TimeZone } from "../time/time-zone.port.ts";
import { comebacksOf } from "./comeback.ts";
import {
  comebackKey,
  graduationKey,
  pauseKey,
  recalcKey,
  seasonCloseKey,
  seasonStartKey,
  sessionKey,
  weekKey,
} from "./feed-key.ts";
import type { FeedRecord } from "./feed-record.ts";
import { isConsistentWeek, memberWeeklySeries } from "./week-figures.ts";

/**
 * Everything `deriveFeed` reads, already loaded: the derivation is pure (ADR-0018, F1). Nothing
 * here is a repository, and nothing private (reviews, closure decisions, photos) is in it.
 */
export interface FeedWorld {
  readonly season: Season;
  /** The season's resolved start day: the feed only exists for a started season. */
  readonly actualStart: LocalDate;
  /** The engine's "today" (0-based season day) in the season's time zone. */
  readonly today: SeasonDay;
  /** Live entries of the season, whoever owns them. */
  readonly entries: readonly EntryRecord[];
  /** The season's pause requests with their effective decision (the choke point's output). */
  readonly requests: readonly EffectivePauseRequest[];
  /** At least the habits of the season's commitments; a missing one is tolerated by the view. */
  readonly habits: readonly Habit[];
  /**
   * The graduate decisions of THIS season's closures, nothing else of them (F8). Never derived
   * from `Habit.graduatedAt`: a habit can be reused and graduated in another circle.
   */
  readonly graduations: readonly SeasonGraduation[];
  /** Turns the instant a closure graduated a habit into the season's civil day. */
  readonly timeZone: TimeZone;
}

const DAYS_PER_WEEK = 7;
/** A week turns final the day after its grace day: its last day, plus 1 grace day, plus 1. */
const FINAL_AFTER_WEEK_START = DAYS_PER_WEEK + 1;

/** Exact sum of fractions (the engine keeps its own `add` internal). */
function sumOf(values: readonly Fraction[]): Fraction {
  return values.reduce((a, b) => frac(a.num * b.den + b.num * a.den, a.den * b.den), fromInt(0));
}

function quantityOf(entry: EntryRecord): Fraction {
  return entry.value.kind === "quantity" ? entry.value.value : fromInt(1);
}

function dateOfDay(world: FeedWorld, day: SeasonDay): LocalDate {
  return localDateOfSeasonDay(day, world.actualStart);
}

function memberIdsOf(season: Season): readonly MemberId[] {
  return [...new Set(season.commitments.map((commitment) => commitment.memberId))];
}

function seasonItems(world: FeedWorld): FeedRecord[] {
  const { season } = world;
  const items: FeedRecord[] = [
    {
      kind: "seasonStarted",
      key: seasonStartKey(season.id),
      onDate: world.actualStart,
      at: null,
      lengthWeeks: season.lengthWeeks,
    },
  ];
  const closeDates = season.status === "closed" ? closeDatesOf(season) : null;
  if (closeDates !== null) {
    items.push({
      kind: "seasonClosed",
      key: seasonCloseKey(season.id),
      onDate: closeDates.resultsOn,
      at: null,
    });
  }
  return items;
}

/** One item per per-session opportunity whose summed live entries reach a progress above 0 (F4). */
function completedItems(world: FeedWorld): FeedRecord[] {
  const items: FeedRecord[] = [];
  for (const commitment of world.season.commitments) {
    if (commitment.measure.schedule.period !== "perSession") continue;
    const byDay = new Map<number, EntryRecord[]>();
    for (const entry of world.entries) {
      if (entry.commitmentId !== commitment.id || entry.value.kind === "missed") continue;
      byDay.set(entry.day, [...(byDay.get(entry.day) ?? []), entry]);
    }
    const engineCommitment = commitmentToEngine(commitment);
    for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
      const entries = byDay.get(day) ?? [];
      const total = sumOf(entries.map(quantityOf));
      if (!gt(progressAtValue(engineCommitment, total), fromInt(0))) continue;
      const opportunity = seasonDay(day);
      items.push({
        kind: "completed",
        key: sessionKey(commitment.id, day + 1),
        onDate: dateOfDay(world, opportunity),
        // `byDay` only holds non-empty lists, so the reduce has a first element.
        at: entries.map((e) => e.recordedAt).reduce((a, b) => (b > a ? b : a)),
        memberId: commitment.memberId,
        commitmentId: commitment.id,
        amount: commitment.measure.unit === "done" ? null : total,
      });
    }
  }
  return items;
}

function consistentWeekItems(world: FeedWorld): FeedRecord[] {
  const items: FeedRecord[] = [];
  const owners = new Map(world.season.commitments.map((c) => [c.id, c.memberId]));
  for (const memberId of memberIdsOf(world.season)) {
    const series = memberWeeklySeries({
      season: world.season,
      actualStart: world.actualStart,
      memberId,
      entries: world.entries,
      requests: world.requests,
      today: world.today,
    });
    for (const { commitmentId, weeks } of series) {
      for (const figures of weeks) {
        if (!isConsistentWeek(figures)) continue;
        items.push({
          kind: "consistentWeek",
          key: weekKey(commitmentId, figures.week + 1),
          onDate: dateOfDay(
            world,
            seasonDay(figures.week * DAYS_PER_WEEK + FINAL_AFTER_WEEK_START),
          ),
          at: null,
          memberId: owners.get(commitmentId) ?? memberId,
          commitmentId,
          week: figures.week + 1,
          kept: figures.kept,
          counted: figures.counted,
        });
      }
    }
  }
  return items;
}

function comebackItems(world: FeedWorld): FeedRecord[] {
  const enginePauses = world.requests.flatMap(({ record, decision }) =>
    toEnginePauses(record, decision),
  );
  const items: FeedRecord[] = [];
  for (const memberId of memberIdsOf(world.season)) {
    const own = world.season.commitments.filter((c) => c.memberId === memberId);
    const active = new Map<number, boolean>();
    const isActiveDay = (day: SeasonDay): boolean => {
      const known = active.get(day);
      if (known !== undefined) return known;
      const result = own.some(
        (commitment) =>
          !isPaused({
            season: world.season,
            actualStart: world.actualStart,
            commitment,
            day,
            today: world.today,
            pauses: enginePauses.filter((pause) => pause.commitmentId === commitment.id),
          }),
      );
      active.set(day, result);
      return result;
    };
    const entries = world.entries.filter((entry) => entry.memberId === memberId);
    for (const { day, at } of comebacksOf({ entries, isActiveDay })) {
      items.push({
        kind: "comeback",
        key: comebackKey(memberId, day + 1),
        onDate: dateOfDay(world, day),
        at,
        memberId,
      });
    }
  }
  return items;
}

/** Whether a request's commitment covers at least one day: from the start through its end or early resume. */
function coversADay(
  record: PauseRequestRecord,
  item: PauseRequestRecord["commitments"][number],
): boolean {
  const lastDay: number =
    record.end.kind === "fixed" ? record.end.lastDay : Number.POSITIVE_INFINITY;
  const effective =
    item.resumedOn === null || lastDay < item.resumedOn - 1 ? lastDay : item.resumedOn - 1;
  return effective >= record.startDay;
}

function pauseItems(world: FeedWorld): FeedRecord[] {
  const items: FeedRecord[] = [];
  for (const { record, decision } of world.requests) {
    if (decision.status !== "approved") continue;
    const commitmentIds = record.commitments
      .filter((item) => coversADay(record, item))
      .map((item) => item.commitmentId);
    if (commitmentIds.length === 0) continue;
    const onDate = dateOfDay(world, decision.decidedOn);
    items.push(
      {
        kind: "paused",
        key: pauseKey(record.id),
        onDate,
        at: decision.decidedAt,
        memberId: record.memberId,
        commitmentIds,
        reason: record.reason,
      },
      {
        kind: "pointsRecalculated",
        key: recalcKey(record.id),
        onDate,
        at: decision.decidedAt,
        memberId: record.memberId,
        commitmentIds,
      },
    );
  }
  return items;
}

/**
 * One item per habit this season's members graduated at its close (F8). The fact comes from the
 * season's own graduate decisions, never from `Habit.graduatedAt`: the habit may be reused in
 * another circle and graduated there. The privacy is the feed season's commitment's.
 */
function graduationItems(world: FeedWorld): FeedRecord[] {
  const byHabit = new Map<HabitId, { commitments: CommitmentRecord[]; decidedAt: Instant }>();
  for (const { commitmentId, decidedAt } of world.graduations) {
    const commitment = world.season.commitments.find((c) => c.id === commitmentId);
    if (commitment === undefined || byHabit.has(commitment.habitId)) continue;
    byHabit.set(commitment.habitId, {
      commitments: world.season.commitments.filter(
        (c) => c.habitId === commitment.habitId && c.memberId === commitment.memberId,
      ),
      decidedAt,
    });
  }
  const items: FeedRecord[] = [];
  for (const [habitId, { commitments, decidedAt }] of byHabit) {
    const first = commitments[0];
    if (first === undefined) continue;
    items.push({
      kind: "graduated",
      key: graduationKey(habitId),
      onDate: world.timeZone.localDateAt(decidedAt, world.season.timeZone),
      at: decidedAt,
      memberId: first.memberId,
      habitId,
      commitmentIds: commitments.map((commitment) => commitment.id),
    });
  }
  return items;
}

/**
 * The circle's activity of one started season, derived from its entries, effective pauses,
 * the season's own graduate decisions and dates (ADR-0018, F1). Pure and unordered: the query sorts and pages it,
 * and `feed-view.ts` shows it to a viewer. Entries stay the source of truth, so an edit, a delete
 * or a pause changes the feed on the next read with no sync step.
 */
export function deriveFeed(world: FeedWorld): readonly FeedRecord[] {
  return [
    ...seasonItems(world),
    ...completedItems(world),
    ...consistentWeekItems(world),
    ...comebackItems(world),
    ...pauseItems(world),
    ...graduationItems(world),
  ];
}
