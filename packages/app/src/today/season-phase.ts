import type { SeasonDay } from "@pactjoy/engine";
import { seasonDay } from "@pactjoy/engine";
import type { Season } from "../season/season.ts";
import type { LocalDate } from "../time/local-date.ts";
import { toSeasonDay } from "../time/season-calendar.ts";

export const DAYS_PER_WEEK = 7;

/**
 * Where a season stands on a given local date. `ended` is derived from the date because no job
 * closes seasons yet. For `active` and `ended`, `day` is the raw season day and `scoringDay` the
 * one scoring reads: today while running, the last season day once over. Callers treat a
 * `closed` season as no season before asking.
 */
export type SeasonPhaseName = "pactOpen" | "notStarted" | "active" | "ended";

export type SeasonPhase =
  | { readonly phase: "pactOpen" }
  | { readonly phase: "notStarted" }
  | {
      readonly phase: "active" | "ended";
      readonly day: SeasonDay;
      readonly scoringDay: SeasonDay;
      readonly lastDay: SeasonDay;
    };

export function seasonPhase(season: Season, today: LocalDate): SeasonPhase {
  if (season.status === "pactOpen") {
    return { phase: "pactOpen" };
  }
  if (season.actualStart === null) {
    return { phase: "notStarted" };
  }
  const day = toSeasonDay(today, season.actualStart);
  if (day.kind === "beforeStart") {
    return { phase: "notStarted" };
  }
  const totalDays = season.lengthWeeks * DAYS_PER_WEEK;
  const lastDay = seasonDay(totalDays - 1);
  const ended = day.day >= totalDays;
  // Scoring reads the last season day once the season is over (design: ended).
  return {
    phase: ended ? "ended" : "active",
    day: day.day,
    scoringDay: ended ? lastDay : day.day,
    lastDay,
  };
}

/** 1-based week of the season; stays on the last week once the season has ended. */
export function weekOf(scoringDay: SeasonDay): number {
  return (scoringDay - (scoringDay % DAYS_PER_WEEK)) / DAYS_PER_WEEK + 1;
}
