import { seasonDay } from "@pactjoy/engine";
import type { ReviewCadenceWeeks, SeasonLengthWeeks } from "../season/season.ts";
import type { LocalDate } from "../time/local-date.ts";
import { localDateOfSeasonDay, toSeasonDay } from "../time/season-calendar.ts";
import type { ReviewKind, ReviewRecord, ReviewStatus, SrbaiMode } from "./review.ts";

/**
 * The review calendar, pure: which reviews a season has, when each one is due and when it lapses.
 * This is the ONE place that answers "is a review due" (REQ-R7): due, lapsed and done are derived
 * on read from the season day, the cadence and what is stored; nothing is stored for them and
 * nothing is written by reading (ADR-0013 style).
 *
 * DAYS ARE 1-BASED here, like the spec: season day 1 is the start day and week w is days
 * `(w-1)*7+1 .. w*7`. The engine's `SeasonDay` is 0-based, so `reviewDayOf` converts ONCE (the
 * engine day plus one) and everything below stays in 1-based days.
 *
 * With `L` the season length in weeks and `c` the cadence, `P = ceil(L/c)` and period k covers
 * weeks `(k-1)c+1 .. min(kc, L)`; the last one is shortened when `c` does not divide `L`:
 * - the baseline (index 0) is offered from pact close through day 7;
 * - interim review k (1..P-1) is due on days `k*c*7+1 .. min((k+1)c, L)*7`, i.e. from the first day
 *   of period k+1 until the day before the next review becomes due, then it LAPSES;
 * - the closing review (k = P) is due from day `L*7+1` and never lapses in this change.
 * The windows are disjoint, so at most ONE review is due at any instant.
 *
 * Full SRBAI (all four items) is asked in the baseline, the closing review and exactly one interim
 * review, the one nearest mid-season; every other interim review asks item 1 only.
 */

const DAYS_PER_WEEK = 7;
/** The baseline is offered through the end of week 1. */
const BASELINE_LAST_DAY = DAYS_PER_WEEK;

/** Where "today" stands against the season: before day 1, or on a 1-based season day. */
export type ReviewDay =
  | { readonly kind: "beforeStart" }
  | { readonly kind: "day"; readonly day: number };

export interface ReviewPeriod {
  /** 0 for the baseline, 1..P for the periods of the season. */
  readonly index: number;
  readonly kind: ReviewKind;
  readonly srbai: SrbaiMode;
  /** The weeks the period covers (1-based, inclusive); `null` for the baseline, which has no summary. */
  readonly firstWeek: number | null;
  readonly lastWeek: number | null;
  /** First day (1-based) the review is due; `null` for the baseline, which is due from pact close. */
  readonly dueFromDay: number | null;
  /** Last day (1-based, inclusive) the review is due; `null` when it never lapses (the closing review). */
  readonly dueToDay: number | null;
}

export type ReviewSlotStatus = "upcoming" | "due" | "completed" | "skipped" | "lapsed";

export interface ReviewSlot extends ReviewPeriod {
  readonly status: ReviewSlotStatus;
}

export const BASELINE_PERIOD: ReviewPeriod = {
  index: 0,
  kind: "baseline",
  srbai: "full",
  firstWeek: null,
  lastWeek: null,
  dueFromDay: null,
  dueToDay: BASELINE_LAST_DAY,
};

function smaller(a: number, b: number): number {
  return a < b ? a : b;
}

function ceilDiv(a: number, b: number): number {
  const rest = a % b;
  return (a - rest) / b + (rest === 0 ? 0 : 1);
}

function distance(a: number, b: number): number {
  return a < b ? b - a : a - b;
}

/**
 * The interim review (1..P-1) that asks the full SRBAI: the one whose end week `k*c` is nearest to
 * the middle of the season, a tie going to the lowest k. On integers: the smallest
 * `|2kc - L|` (which is `2 * |kc - L/2|`, so no midpoint fraction is needed).
 */
export function midSeasonPeriodIndex(
  lengthWeeks: SeasonLengthWeeks,
  cadence: ReviewCadenceWeeks,
): number {
  const periods = ceilDiv(lengthWeeks, cadence);
  let best = 1;
  for (let k = 2; k < periods; k++) {
    if (distance(2 * k * cadence, lengthWeeks) < distance(2 * best * cadence, lengthWeeks))
      best = k;
  }
  return best;
}

/** The periods 1..P of a season (the baseline is {@link BASELINE_PERIOD}); the last is the closing review. */
export function reviewPeriods(
  lengthWeeks: SeasonLengthWeeks,
  cadence: ReviewCadenceWeeks,
): readonly ReviewPeriod[] {
  const count = ceilDiv(lengthWeeks, cadence);
  const mid = midSeasonPeriodIndex(lengthWeeks, cadence);
  return Array.from({ length: count }, (_, i): ReviewPeriod => {
    const index = i + 1;
    const closing = index === count;
    const dueFromWeek = smaller(index * cadence, lengthWeeks);
    return {
      index,
      kind: closing ? "closing" : "interim",
      srbai: closing || index === mid ? "full" : "item1",
      firstWeek: i * cadence + 1,
      lastWeek: smaller(index * cadence, lengthWeeks),
      dueFromDay: dueFromWeek * DAYS_PER_WEEK + 1,
      dueToDay: closing ? null : smaller((index + 1) * cadence, lengthWeeks) * DAYS_PER_WEEK,
    };
  });
}

/**
 * The single conversion from a civil date to a 1-based season day. A season with no start yet
 * (pact open) and any date before the start are both `beforeStart`.
 */
export function reviewDayOf(today: LocalDate, seasonStart: LocalDate | null): ReviewDay {
  if (seasonStart === null) return { kind: "beforeStart" };
  const result = toSeasonDay(today, seasonStart);
  return result.kind === "beforeStart"
    ? { kind: "beforeStart" }
    : { kind: "day", day: result.day + 1 };
}

export interface ReviewSlotsInput {
  readonly lengthWeeks: SeasonLengthWeeks;
  readonly cadence: ReviewCadenceWeeks;
  /** The pact is closed (approved): the baseline cannot be offered before that. */
  readonly pactClosed: boolean;
  readonly today: ReviewDay;
  /** What the member has stored (any order); only the period and status matter here. */
  readonly stored: readonly Pick<ReviewRecord, "periodIndex" | "status">[];
}

function storedStatus(input: ReviewSlotsInput, index: number): ReviewStatus | null {
  return input.stored.find((row) => row.periodIndex === index)?.status ?? null;
}

function windowStatus(
  period: ReviewPeriod,
  today: ReviewDay,
  pactClosed: boolean,
): ReviewSlotStatus {
  const from = period.dueFromDay;
  const to = period.dueToDay;
  if (period.kind === "baseline") {
    if (!pactClosed) return "upcoming";
    if (today.kind === "beforeStart") return "due";
    return today.day <= (to ?? BASELINE_LAST_DAY) ? "due" : "lapsed";
  }
  if (today.kind === "beforeStart" || from === null || today.day < from) return "upcoming";
  if (to === null || today.day <= to) return "due";
  return "lapsed";
}

/**
 * Every slot of the member's season (baseline, then periods 1..P) with its derived status: a
 * stored review is `completed`/`skipped`; otherwise it is `upcoming` before its window, `due`
 * inside it and `lapsed` after it.
 */
export function reviewSlots(input: ReviewSlotsInput): readonly ReviewSlot[] {
  const periods = [BASELINE_PERIOD, ...reviewPeriods(input.lengthWeeks, input.cadence)];
  return periods.map((period): ReviewSlot => {
    const stored = storedStatus(input, period.index);
    const status: ReviewSlotStatus =
      stored !== null ? stored : windowStatus(period, input.today, input.pactClosed);
    return { ...period, status };
  });
}

/** The one slot that is due now, or `null`. At most one exists (the windows are disjoint). */
export function dueSlot(slots: readonly ReviewSlot[]): ReviewSlot | null {
  return slots.find((slot) => slot.status === "due") ?? null;
}

/**
 * The calendar date the review AFTER `afterPeriodIndex` becomes due (REQ-S9), or `null` when
 * `afterPeriodIndex` is the closing review. After the baseline it is the first interim review.
 */
export function nextReviewDate(
  lengthWeeks: SeasonLengthWeeks,
  cadence: ReviewCadenceWeeks,
  afterPeriodIndex: number,
  seasonStart: LocalDate,
): LocalDate | null {
  const next = reviewPeriods(lengthWeeks, cadence).find((p) => p.index === afterPeriodIndex + 1);
  if (next === undefined || next.dueFromDay === null) return null;
  return localDateOfSeasonDay(seasonDay(next.dueFromDay - 1), seasonStart);
}

/**
 * The last calendar day the review can still be answered, or `null` when it never lapses (the
 * closing review). The baseline is open through the end of day 7.
 */
export function dueUntilOf(period: ReviewPeriod, seasonStart: LocalDate): LocalDate | null {
  return period.dueToDay === null
    ? null
    : localDateOfSeasonDay(seasonDay(period.dueToDay - 1), seasonStart);
}
