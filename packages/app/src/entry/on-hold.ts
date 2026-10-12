import { type PauseRequest, type SeasonDay, weekOf, weekProgress } from "@pactjoy/engine";
import type { CommitmentRecord } from "../commitment/commitment.ts";
import { commitmentToEngine } from "../commitment/to-engine.ts";
import { startWeekdayOf } from "../score/score-input.ts";
import type { Season } from "../season/season.ts";
import type { LocalDate } from "../time/local-date.ts";

export interface OnHoldInput {
  readonly season: Season;
  readonly actualStart: LocalDate;
  readonly commitment: CommitmentRecord;
  /** The opportunity day the Entry counts toward. */
  readonly day: SeasonDay;
  /** The season day of the write. */
  readonly today: SeasonDay;
  /** The Commitment's own pause requests, effective at the write clock. */
  readonly pauses: readonly PauseRequest[];
}

/**
 * Whether the opportunity is "en espera" (EW-4): `day` is covered by a
 * still-pending request, so its result can still change. Asked of the
 * engine's own week plan, so it cannot disagree with Today or the score.
 */
export function isOnHold(input: OnHoldInput): boolean {
  return excludedFor(input).onHold.includes(input.day);
}

/**
 * Whether the opportunity is covered by an APPROVED Pause (and not resumed
 * yet): `day` is among the week plan's paused days. A day shared with a
 * pending request is on hold instead, see {@link isOnHold}.
 */
export function isPaused(input: OnHoldInput): boolean {
  return excludedFor(input).paused.includes(input.day);
}

function excludedFor(input: OnHoldInput) {
  const { season, actualStart, commitment, day, today, pauses } = input;
  const progress = weekProgress({
    season: { lengthWeeks: season.lengthWeeks, startWeekday: startWeekdayOf(actualStart) },
    commitment: commitmentToEngine(commitment),
    week: weekOf(day),
    entries: [],
    pauses,
    today,
  });
  return progress.excluded;
}
