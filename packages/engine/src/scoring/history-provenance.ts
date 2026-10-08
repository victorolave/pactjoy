/** Opportunity history from the scoring walk, never a second assignment algorithm. */
import { type SeasonDay, seasonDay } from "../calendar/season-calendar.ts";
import type { Commitment } from "../commitment/commitment.ts";
import { graceDeadline, isOnTime } from "../entry/grace-period.ts";
import { eq, type Fraction, fromInt } from "../fraction/fraction.ts";
import { rejectionExtendedDeadline } from "../pause/pause-aware-week.ts";
import type { WeekExclusions } from "../week/week-progress.ts";
import { type ScoreInput, type ScoringOpportunity, seasonSessions } from "./member-score.ts";

const DAYS_PER_WEEK = 7;
const ONE = fromInt(1);

export type HistoryStatus =
  | "ideal"
  | "minimum"
  | "below"
  | "missed"
  | "unrecorded"
  | "pending"
  | "future";

export interface HistoryOpportunity {
  readonly kind: "day" | "session" | "week";
  /** Scheduled day, selected session's source day, or null for a weekly/unfilled slot. */
  readonly day: SeasonDay | null;
  readonly sourceDays: readonly SeasonDay[];
  /** Positions in the ORIGINAL input.entries, not ids. The app joins its authorized records 1:1. */
  readonly entryIndices: readonly number[];
  readonly value: Fraction | null;
  /** No provisional outcome before R1; raw accumulated value remains available separately. */
  readonly progress: Fraction | null;
  readonly status: HistoryStatus;
  readonly late: boolean;
  readonly counted: boolean;
  readonly editable: boolean;
  readonly final: boolean;
}

export interface HistoryWeek {
  readonly week: number;
  readonly status: "scored" | "paused" | "onHold";
  readonly excluded: WeekExclusions;
  /** Excluded opportunities are absent, not synthetic misses. */
  readonly cells: readonly HistoryOpportunity[];
  /** Eligible entries not assigned to a scoring slot (best-N extras / surplus makeup). */
  readonly extraEntryIndices: readonly number[];
}

function statusOf(
  opportunity: ScoringOpportunity,
  indices: readonly number[],
  input: ScoreInput,
  opensOn: number,
): HistoryStatus {
  if (!opportunity.counted) return input.today < opensOn ? "future" : "pending";
  if (opportunity.session.value === null) return "unrecorded";
  if (indices.length > 0 && indices.every((i) => input.entries[i]?.kind === "missed"))
    return "missed";
  if (eq(opportunity.session.progress, ONE)) return "ideal";
  return opportunity.session.consistent ? "minimum" : "below";
}

/**
 * Pure provenance for ALL season weeks. No notes, entry ids or privacy policy live in the
 * engine: callers MUST authorize detail before passing entries and joining these indices.
 * Assignment, proration, exclusions and R1 facts come directly from E1's seasonSessions.
 */
export function historyProvenance(
  commitment: Commitment,
  input: ScoreInput,
): readonly HistoryWeek[] {
  const pauses = input.pauses.filter((p) => p.commitmentId === commitment.id);
  const kind =
    commitment.schedule.period === "weeklyTotal"
      ? "week"
      : commitment.schedule.frequency.kind === "specificDays"
        ? "day"
        : "session";
  return seasonSessions(commitment, input).weeks.map(({ week, plan, opportunities }) => {
    const start = week * DAYS_PER_WEEK;
    const end = seasonDay(start + DAYS_PER_WEEK - 1);
    const days = Array.from({ length: DAYS_PER_WEEK }, (_, i) => seasonDay(start + i));
    const excluded = {
      paused: days.filter((day) => plan.paused.has(day)),
      onHold: days.filter((day) => plan.onHold.has(day)),
    };
    if (plan.result.status !== "scored")
      return { week, status: plan.result.status, excluded, cells: [], extraEntryIndices: [] };

    // Match the dispatchers' acceptance filter, using their deadline helpers, not R1's
    // counting deadline: specificDays uses each SOURCE day's grace before D5 makeup.
    const weeklyDeadline = rejectionExtendedDeadline(pauses, start, end, graceDeadline(end));
    const eligible = input.entries.flatMap((entry, index) =>
      entry.commitmentId === commitment.id &&
      entry.day >= start &&
      entry.day <= end &&
      !plan.paused.has(entry.day) &&
      !plan.onHold.has(entry.day) &&
      isOnTime(entry, kind === "day" ? graceDeadline(entry.day) : weeklyDeadline)
        ? [index]
        : [],
    );
    const used = new Set<number>();
    const cells = opportunities.map((opportunity, index): HistoryOpportunity => {
      const source = plan.sourceDays[index];
      const indices =
        kind === "week" ? eligible : eligible.filter((i) => input.entries[i]?.day === source);
      for (const i of indices) used.add(i);
      const sourceDays = [
        ...new Set(
          indices.map((i) => input.entries[i]?.day).filter((d): d is SeasonDay => d !== undefined),
        ),
      ].sort((a, b) => a - b);
      return {
        kind,
        day: kind === "day" ? opportunity.day : kind === "session" ? (source ?? null) : null,
        sourceDays,
        entryIndices: indices,
        value: opportunity.session.value,
        progress: opportunity.counted ? opportunity.session.progress : null,
        status: statusOf(opportunity, indices, input, opportunity.day ?? start),
        late: indices.some((i) => {
          const entry = input.entries[i];
          return entry !== undefined && entry.recordedOn > entry.day;
        }),
        counted: opportunity.counted,
        editable: opportunity.editable,
        final: opportunity.final,
      };
    });
    return {
      week,
      status: "scored",
      excluded,
      cells,
      extraEntryIndices: eligible.filter((i) => !used.has(i)),
    };
  });
}
