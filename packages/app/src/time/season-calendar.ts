import type { SeasonDay } from "@pactjoy/engine";
import { seasonDay } from "@pactjoy/engine";
import type { LocalDate } from "./local-date.ts";
import { epochDay, localDateOfEpochDay } from "./local-date.ts";

export type SeasonDayResult =
  | { readonly kind: "beforeStart" }
  | { readonly kind: "day"; readonly day: SeasonDay };

/**
 * Converts a resolved civil date to the engine's 0-based `SeasonDay`
 * (ADR-0004/ADR-0009): pure integer subtraction of epoch days, no
 * `Date`/`Intl` (D8). The timezone-sensitive step already happened
 * upstream in `TimeZone.localDateAt` -- this function takes no zone at
 * all (SC-6), so the same `(date, seasonStart)` pair always returns an
 * identical result (SC-5b), in every runtime.
 */
export function toSeasonDay(date: LocalDate, seasonStart: LocalDate): SeasonDayResult {
  const diff = epochDay(date) - epochDay(seasonStart);
  return diff < 0 ? { kind: "beforeStart" } : { kind: "day", day: seasonDay(diff) };
}

/** The inverse of {@link toSeasonDay}: the calendar date `day` days after `seasonStart`. */
export function localDateOfSeasonDay(day: SeasonDay, seasonStart: LocalDate): LocalDate {
  return localDateOfEpochDay(epochDay(seasonStart) + day);
}
