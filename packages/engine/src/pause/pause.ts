/**
 * Pause request model and its scoring effect: which days are actually
 * paused (approved, D8) or still on hold (pending, R4a) as of a given day.
 * `PauseRequest`s already arrive scoped to one commitment — the "pause
 * all" expansion and the 48h auto-approval workflow both live in
 * packages/app (Q4); the engine only ever sees an already-decided or
 * still-pending request.
 */
import type { SeasonDay } from "../calendar/season-calendar.ts";
import { seasonDay } from "../calendar/season-calendar.ts";
import type { CommitmentId } from "../commitment/commitment.ts";

export type PauseEnd =
  | { readonly kind: "fixed"; readonly lastDay: SeasonDay }
  | { readonly kind: "open" };

export type PauseDecision =
  | { readonly kind: "pending" }
  | {
      readonly kind: "approved";
      readonly decidedOn: SeasonDay;
      readonly resumedOn: SeasonDay | null;
    }
  | { readonly kind: "rejected"; readonly decidedOn: SeasonDay };

export interface PauseRequest {
  readonly commitmentId: CommitmentId;
  readonly requestedOn: SeasonDay;
  readonly startDay: SeasonDay;
  readonly end: PauseEnd;
  readonly decision: PauseDecision;
}

function dayMin(a: number, b: number): number {
  return a < b ? a : b;
}

/**
 * Days from `startDay` through `end` inclusive, as plain (unbranded) numbers
 * until they're pushed — `end` may legitimately be less than `startDay`
 * (e.g. resumed on/before its own start), in which case this yields no
 * days at all, without ever calling {@link seasonDay} on a negative or
 * otherwise invalid intermediate value.
 */
function daysInRange(startDay: SeasonDay, end: number): readonly SeasonDay[] {
  const days: SeasonDay[] = [];
  for (let d: number = startDay; d <= end; d++) {
    days.push(seasonDay(d));
  }
  return days;
}

/**
 * The days an approved pause actually covers: from `startDay` (the request
 * date — approval only decides *whether* those days pause, never *when*
 * they start, E17) through the earliest of a fixed end, an early resume
 * (`resumedOn`, which applies regardless of the end kind — E22), or `today`
 * (an open pause not yet resumed is paused "as of today", the same
 * snapshot rule D12 already uses for mid-season points). Pending and
 * rejected requests contribute no days here — see {@link pendingHoldDays}
 * for R4a's still-undecided days.
 */
export function effectivePausedDays(
  pauses: readonly PauseRequest[],
  today: SeasonDay,
): ReadonlySet<SeasonDay> {
  const days = new Set<SeasonDay>();
  for (const pause of pauses) {
    if (pause.decision.kind !== "approved") continue;
    const naturalEnd: number = pause.end.kind === "fixed" ? pause.end.lastDay : today;
    const { resumedOn } = pause.decision;
    const end: number = resumedOn === null ? naturalEnd : dayMin(naturalEnd, resumedOn - 1);
    for (const day of daysInRange(pause.startDay, end)) days.add(day);
  }
  return days;
}

/**
 * R4a: the days a still-*pending* request would cover, up to `today` —
 * excluded from every average while undecided ("en espera"). Once the
 * request is decided, a fresh call with the resolved `decision` naturally
 * recomputes: there is no separate "recompute" step, the same statelessness
 * slice 4 already relies on for non-compensation.
 */
export function pendingHoldDays(
  pauses: readonly PauseRequest[],
  today: SeasonDay,
): ReadonlySet<SeasonDay> {
  const days = new Set<SeasonDay>();
  for (const pause of pauses) {
    if (pause.decision.kind !== "pending") continue;
    const naturalEnd = pause.end.kind === "fixed" ? pause.end.lastDay : today;
    for (const day of daysInRange(pause.startDay, dayMin(naturalEnd, today))) days.add(day);
  }
  return days;
}
