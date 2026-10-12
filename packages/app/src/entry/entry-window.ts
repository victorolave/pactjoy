import {
  entryGraceDeadline,
  type PauseRequest,
  type Schedule,
  type SeasonDay,
} from "@pactjoy/engine";

export type EntryWindowError =
  | { readonly kind: "FutureDay" }
  | { readonly kind: "OutsideSeason" }
  | { readonly kind: "WindowClosed" };

export interface EntryWindowInput {
  readonly schedule: Schedule;
  /** The opportunity day the entry counts toward. */
  readonly day: SeasonDay;
  /** The season day "now" falls on (resolved upstream in the season's timezone). */
  readonly today: SeasonDay;
  readonly lengthWeeks: number;
  /**
   * The Commitment's OWN pause requests, effective at the write clock (from
   * `loadEffectivePauses`, filtered to the Commitment). A rejected or
   * cancelled one extends the window (gracePeriod); required, so no caller
   * can forget to wire it.
   */
  readonly pauses: readonly PauseRequest[];
}

const DAYS_PER_WEEK = 7;

/**
 * The last day an entry for `day` may still be recorded, edited or deleted:
 * the engine's `entryGraceDeadline`, the SAME deadline scoring uses to accept
 * the entry, so the window and the score cannot drift apart. The ONE formula
 * behind {@link checkEntryWindow} and the `graceUntil` Today shows.
 */
export function entryWindowDeadline(
  schedule: Schedule,
  day: SeasonDay,
  pauses: readonly PauseRequest[],
): SeasonDay {
  return entryGraceDeadline(schedule, day, pauses);
}

/**
 * Whether an entry for `day` may be recorded (or edited/deleted) `today`
 * (ER-2, ER-8, ER-9, ER-10..ER-13): not in the future (A10), inside the
 * season, and no later than the opportunity's deadline
 * ({@link entryWindowDeadline}: end of the next day, or of `decidedOn + 1`
 * after a rejection). Everything is SeasonDay arithmetic: real time was
 * already converted by the Clock/season-calendar (ADR-0004, ADR-0009).
 */
export function checkEntryWindow(input: EntryWindowInput): EntryWindowError | null {
  if (input.day > input.today) {
    return { kind: "FutureDay" };
  }
  if (input.day >= input.lengthWeeks * DAYS_PER_WEEK) {
    return { kind: "OutsideSeason" };
  }
  const deadline = entryWindowDeadline(input.schedule, input.day, input.pauses);
  return input.today > deadline ? { kind: "WindowClosed" } : null;
}
