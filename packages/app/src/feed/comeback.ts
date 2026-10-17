import { type SeasonDay, seasonDay } from "@pactjoy/engine";
import type { EntryRecord } from "../entry/entry.ts";
import type { Instant } from "../time/instant.ts";

/**
 * How many ACTIVE days with no entry at all must separate two entries of a member for the second
 * to be a "volvió" (owner decision, 2026-10-17). One constant, so the rule is tuned in one place.
 */
export const COMEBACK_GAP_DAYS = 3;

export interface ComebackInput {
  /** ONE member's live entries, on any of their commitments, in any order. */
  readonly entries: readonly EntryRecord[];
  /** Whether at least one of the member's commitments is not paused on `day`. */
  readonly isActiveDay: (day: SeasonDay) => boolean;
}

export interface Comeback {
  /** The opportunity day the member came back on. */
  readonly day: SeasonDay;
  /** The earliest `recordedAt` of that day's non-missed entries. */
  readonly at: Instant;
}

/**
 * The member's comebacks (ADR-0018, F6). A comeback is the first NON-MISSED entry of a day D whose
 * previous day with ANY entry (a `missed` one included: it is presence, "hoy no salió" is still
 * showing up) leaves at least {@link COMEBACK_GAP_DAYS} active days strictly between the two.
 * Days under a Pause are not active, so they never count toward the gap. The first entry of the
 * season has no previous day, so it is not a comeback. No gap length leaves this function: the
 * feed never emphasizes absence.
 */
export function comebacksOf(input: ComebackInput): readonly Comeback[] {
  // Every day with an entry is present; its value is the earliest non-missed record, if any.
  const byDay = new Map<number, Instant | null>();
  for (const entry of input.entries) {
    const known = byDay.get(entry.day) ?? null;
    const isDone = entry.value.kind !== "missed";
    byDay.set(
      entry.day,
      isDone && (known === null || entry.recordedAt < known) ? entry.recordedAt : known,
    );
  }

  const present = [...byDay.keys()].sort((a, b) => a - b);
  const result: Comeback[] = [];
  for (const [index, day] of present.entries()) {
    const previous = present[index - 1];
    const first = byDay.get(day) ?? null;
    if (previous === undefined || first === null) continue;
    let active = 0;
    for (let between = previous + 1; between < day; between++) {
      if (input.isActiveDay(seasonDay(between))) active += 1;
    }
    if (active >= COMEBACK_GAP_DAYS) result.push({ day: seasonDay(day), at: first });
  }
  return result;
}
